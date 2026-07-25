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

export const smsService = {
  async send(phoneNumbers: string[], message: string): Promise<void> {
    if (!config.sms.apiKey || !config.sms.username) {
      logger.warn('SMS not configured — skipping', { recipients: phoneNumbers.length });
      return;
    }
    try {
      const params = new URLSearchParams({
        username: config.sms.username,
        to:       phoneNumbers.join(','),
        message,
        from:     config.sms.senderId,
      });

      const { data } = await axios.post(
        `${config.sms.baseUrl}/messaging`,
        params.toString(),
        {
          headers: {
            apiKey:         config.sms.apiKey,
            Accept:         'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 10000,
        }
      );

      const recipients = data?.SMSMessageData?.Recipients ?? [];
      const failed = recipients.filter((r: any) => r.statusCode !== 101);
      if (failed.length) logger.warn('SMS partial failure', { failed });
      logger.info('SMS sent', { recipients: recipients.length });
    } catch (err: any) {
      logger.error('SMS send failed', { error: err.message });
    }
  },

  async sendFarmAlert(farmId: string, title: string, recommendation: string): Promise<void> {
    // Get farm owner phone
    const rows = await dbQuery(
      `SELECT u.phone FROM users u JOIN farms f ON f.owner_id=u.id WHERE f.id=$1 AND u.phone IS NOT NULL`,
      [farmId]
    );
    if (!rows.length) return;
    const phones = rows.map((r: any) => r.phone);
    const msg = `AgriSense Alert: ${title}\n${recommendation}\nReply STOP to opt out.`;
    await this.send(phones, msg);
  },

  async sendWelcome(phone: string, name: string): Promise<void> {
    const msg = `Welcome to AgriSense, ${name}! Your smart farming platform is ready. Login at agrisense.io to view your dashboard.`;
    await this.send([phone], msg);
  },

  async sendOtp(phone: string, otp: string): Promise<void> {
    const msg = `Your AgriSense verification code is: ${otp}. Valid for 10 minutes. Do not share this code.`;
    await this.send([phone], msg);
  },
};
