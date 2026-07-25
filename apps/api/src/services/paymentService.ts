/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import axios from 'axios';
import { config } from '../config';
import { dbQuery } from '../db';
import { logger } from '../utils/logger';

const BASE_URL = config.mpesa.env === 'sandbox'
  ? 'https://sandbox.safaricom.co.ke'
  : 'https://api.safaricom.co.ke';

const TIER_PRICES: Record<string, number> = {
  FARMER:       2200,   // KES per month (~$17)
  PROFESSIONAL: 12000,  // KES per month (~$92)
};

async function getAccessToken(): Promise<string> {
  const credentials = Buffer.from(`${config.mpesa.consumerKey}:${config.mpesa.consumerSecret}`).toString('base64');
  const { data } = await axios.get(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
    timeout: 8000,
  });
  return data.access_token;
}

function generatePassword(): { password: string; timestamp: string } {
  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
  const password = Buffer.from(`${config.mpesa.shortcode}${config.mpesa.passkey}${timestamp}`).toString('base64');
  return { password, timestamp };
}

export const paymentService = {
  async initiateSTKPush(params: {
    phoneNumber: string;
    amount: number;
    accountRef: string;
    description: string;
    userId: string;
    tier: string;
  }): Promise<{ checkoutRequestId: string; merchantRequestId: string }> {
    if (!config.mpesa.consumerKey) {
      throw new Error('M-Pesa not configured');
    }
    const token = await getAccessToken();
    const { password, timestamp } = generatePassword();

    // Format phone: 07XXXXXXXX → 2547XXXXXXXX
    const phone = params.phoneNumber.replace(/^0/, '254').replace(/^\+/, '');

    const { data } = await axios.post(
      `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: config.mpesa.shortcode,
        Password:          password,
        Timestamp:         timestamp,
        TransactionType:   'CustomerPayBillOnline',
        Amount:            Math.round(params.amount),
        PartyA:            phone,
        PartyB:            config.mpesa.shortcode,
        PhoneNumber:       phone,
        CallBackURL:       config.mpesa.callbackUrl,
        AccountReference:  params.accountRef,
        TransactionDesc:   params.description,
      },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
    );

    // Store pending transaction
    await dbQuery(
      `INSERT INTO audit_logs (user_id, action, entity_type, new_value)
       VALUES ($1, 'PAYMENT_INITIATED', 'subscription', $2)`,
      [params.userId, JSON.stringify({
        checkoutRequestId: data.CheckoutRequestID,
        merchantRequestId: data.MerchantRequestID,
        tier: params.tier,
        amount: params.amount,
      })]
    );

    logger.info('STK Push initiated', { userId: params.userId, amount: params.amount });
    return {
      checkoutRequestId: data.CheckoutRequestID,
      merchantRequestId: data.MerchantRequestID,
    };
  },

  async handleCallback(body: any): Promise<void> {
    const result = body?.Body?.stkCallback;
    if (!result) return;

    const success = result.ResultCode === 0;
    logger.info('M-Pesa callback', { merchantRequestId: result.MerchantRequestID, success });

    if (success) {
      // Extract metadata
      const items = result.CallbackMetadata?.Item ?? [];
      const get = (name: string) => items.find((i: any) => i.Name === name)?.Value;
      const amount = get('Amount');
      const phone  = get('PhoneNumber');
      const mpesaRef = get('MpesaReceiptNumber');

      // Determine tier from amount
      let tier = 'FREE';
      if (amount >= 12000) tier = 'PROFESSIONAL';
      else if (amount >= 2000) tier = 'FARMER';

      // Update user tier — find user by phone
      await dbQuery(
        `UPDATE users SET tier = $1::subscription_tier, tier_expires_at = NOW() + INTERVAL '31 days'
         WHERE phone LIKE $2`,
        [tier, `%${String(phone).slice(-9)}`]
      );

      await dbQuery(
        `INSERT INTO audit_logs (action, entity_type, new_value)
         VALUES ('PAYMENT_SUCCESS', 'subscription', $1)`,
        [JSON.stringify({ mpesaRef, amount, phone, tier })]
      );
    }
  },

  getTierPrice(tier: string): number {
    return TIER_PRICES[tier] ?? 0;
  },
};
