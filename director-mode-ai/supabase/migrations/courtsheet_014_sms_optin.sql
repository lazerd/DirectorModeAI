-- ============================================
-- CourtSheet AI — Migration 014
-- SMS opt-in on signups + bookings.
-- ============================================
-- Adds two optional columns to reservation_signups so a player joining a
-- clinic / doubles / social can opt into a one-shot Twilio confirmation
-- text. The booker-side SMS for staff bookings rides on reservations.meta
-- (no schema change needed — meta is already JSONB).
--
-- Uses the existing src/lib/twilio.ts (TWILIO_ACCOUNT_SID/AUTH_TOKEN/
-- PHONE_NUMBER) and the Pro tier's 200 SMS/month budget from billing.ts.
-- No new env vars required.
--
-- Safe to re-run.
-- ============================================

ALTER TABLE reservation_signups
  ADD COLUMN IF NOT EXISTS sms_phone   TEXT,
  ADD COLUMN IF NOT EXISTS sms_opt_in  BOOLEAN NOT NULL DEFAULT false;
