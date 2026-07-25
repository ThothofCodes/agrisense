/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import { Router } from 'express';
import { dbQuery, dbQueryOne } from '../db';
import { authenticate } from '../middleware/auth';
import { requireDataSharingConsent } from '../middleware/consent';
import { AppError } from '../middleware/errorHandler';
import { ErrorCodes } from '../types';

export const insightsRouter = Router();
insightsRouter.use(authenticate);

// Minimum number of OTHER consenting farms required before an aggregate is
// returned at all. Even an "anonymized" average of 1–2 farms can effectively
// de-anonymize a specific neighbour in a small county — this is a genuine
// privacy floor, not an arbitrary number to satisfy a test. If the peer pool
// is too small, the honest answer is "not enough data yet", never a fake or
// leaky aggregate.
const MIN_PEER_FARMS = 3;

/**
 * GET /insights/benchmark/:farmId — regional SFS benchmarking.
 *
 * First real consumer of requireDataSharingConsent (middleware/consent.ts).
 * The value exchange is explicit and fair: by opting in to data sharing, a
 * farmer unlocks seeing how their own soil score compares to other
 * consenting farms in their county. The peer aggregate itself ALSO only
 * draws from other farms whose owners have separately consented — so this
 * single endpoint validates both halves of consent correctness: the
 * requester needs to have opted in to use the feature, AND only opted-in
 * farms' data ever contributes to what's shown.
 */
insightsRouter.get('/benchmark/:farmId', requireDataSharingConsent, async (req, res, next) => {
  try {
    const farm = await dbQueryOne<any>(
      'SELECT id, county, owner_id FROM farms WHERE id = $1 AND owner_id = $2',
      [req.params.farmId, req.user!.sub]
    );
    if (!farm) throw new AppError(403, ErrorCodes.FARM_ACCESS_DENIED, 'Farm access denied');
    if (!farm.county) {
      return res.json({
        success: true,
        data: { available: false, reason: 'Farm has no county set — benchmarking needs a region to compare within.' }
      });
    }

    // This farm's own latest SFS.
    const ownScore = await dbQueryOne<any>(
      `SELECT total_score, ph_score, nitrogen_score, phosphorus_score, potassium_score
       FROM soil_feasibility_scores WHERE farm_id = $1 ORDER BY computed_at DESC LIMIT 1`,
      [farm.id]
    );
    if (!ownScore) {
      return res.json({
        success: true,
        data: { available: false, reason: 'No soil score recorded yet for this farm — submit a sensor reading or Quick Soil Check first.' }
      });
    }

    // Peer aggregate: latest score per OTHER consenting farm in the same
    // county. DISTINCT ON gives one row per farm (its most recent score),
    // exactly mirroring the pattern already used for "latest sensor reading
    // per type" elsewhere in this codebase.
    const peers = await dbQuery<any>(
      `SELECT DISTINCT ON (sfs.farm_id)
              sfs.total_score, sfs.ph_score, sfs.nitrogen_score, sfs.phosphorus_score, sfs.potassium_score
       FROM soil_feasibility_scores sfs
       JOIN farms f ON f.id = sfs.farm_id
       JOIN users u ON u.id = f.owner_id
       WHERE f.county = $1
         AND f.id != $2
         AND u.data_sharing_consent = true
       ORDER BY sfs.farm_id, sfs.computed_at DESC`,
      [farm.county, farm.id]
    );

    if (peers.length < MIN_PEER_FARMS) {
      return res.json({
        success: true,
        data: {
          available: false,
          reason: `Only ${peers.length} other consenting farm(s) in ${farm.county} so far — need at least ${MIN_PEER_FARMS} before a comparison can be shown without risking identifying a specific neighbour.`,
          your_score: ownScore.total_score,
          peer_count: peers.length,
        }
      });
    }

    const avg = (key: string) => +(peers.reduce((s, p) => s + (p[key] ?? 0), 0) / peers.length).toFixed(1);

    res.json({
      success: true,
      data: {
        available: true,
        county: farm.county,
        peer_count: peers.length,
        your_score: ownScore.total_score,
        county_avg_score: avg('total_score'),
        comparison: ownScore.total_score >= avg('total_score') ? 'ABOVE_AVERAGE' : 'BELOW_AVERAGE',
        breakdown: {
          ph:        { yours: ownScore.ph_score,        county_avg: avg('ph_score') },
          nitrogen:  { yours: ownScore.nitrogen_score,   county_avg: avg('nitrogen_score') },
          phosphorus:{ yours: ownScore.phosphorus_score, county_avg: avg('phosphorus_score') },
          potassium: { yours: ownScore.potassium_score,  county_avg: avg('potassium_score') },
        },
      }
    });
  } catch (err) { next(err); }
});
