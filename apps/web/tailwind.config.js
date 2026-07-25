/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        forest:    { DEFAULT: '#1B4332', dark: '#0D2818', mid: '#2D6A4F' },
        sage:      { DEFAULT: '#52796F', light: '#84A98C', pale: '#D8F3DC' },
        amber:     { DEFAULT: '#D4A017', light: '#F9E07B', pale: '#FEF9EA' },
        parchment: { DEFAULT: '#FAFAF8', dark: '#F0F0EC' },
      },
      fontFamily: {
        display: ['Lora', 'Georgia', 'serif'],
        sans:    ['DM Sans', 'system-ui', 'sans-serif'],
        mono:    ['DM Mono', 'monospace'],
      },
      boxShadow: {
        card:   '0 2px 8px rgba(27,67,50,0.10)',
        'card-hover': '0 6px 20px rgba(27,67,50,0.16)',
        float:  '0 8px 32px rgba(27,67,50,0.14)',
      },
      animation: {
        'fade-up':   'fadeUp 0.4s ease-out',
        'bar-grow':  'barGrow 0.8s ease-out',
        'pulse-dot': 'pulseDot 2s ease-in-out infinite',
      },
      keyframes: {
        fadeUp:   { from: { opacity: 0, transform: 'translateY(16px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        barGrow:  { from: { transform: 'scaleX(0)' }, to: { transform: 'scaleX(1)' } },
        pulseDot: { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.4 } },
      },
    },
  },
  plugins: [],
}
