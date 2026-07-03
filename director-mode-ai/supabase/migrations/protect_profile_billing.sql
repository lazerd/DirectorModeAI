-- SECURITY: users can update their own profile (name, tz, etc.) but must NOT be
-- able to edit billing/subscription columns (that would let them self-grant Pro).
-- Freeze those columns on any non-service-role UPDATE.
create or replace function public.protect_profile_billing() returns trigger
  language plpgsql security definer set search_path=public as $$
begin
  if coalesce(auth.role(),'') = 'service_role' then
    return new;
  end if;
  new.plan_tier                 := old.plan_tier;
  new.subscription_status       := old.subscription_status;
  new.stripe_subscription_status:= old.stripe_subscription_status;
  new.stripe_customer_id        := old.stripe_customer_id;
  new.stripe_subscription_id    := old.stripe_subscription_id;
  new.current_period_end        := old.current_period_end;
  new.trial_end                 := old.trial_end;
  new.grandfathered_trial_ends_at := old.grandfathered_trial_ends_at;
  new.free_dj_event_id          := old.free_dj_event_id;
  new.stripe_account_id         := old.stripe_account_id;
  new.stripe_charges_enabled    := old.stripe_charges_enabled;
  new.stripe_details_submitted  := old.stripe_details_submitted;
  new.stripe_payouts_enabled    := old.stripe_payouts_enabled;
  return new;
end $$;

drop trigger if exists protect_profile_billing on profiles;
create trigger protect_profile_billing before update on profiles
  for each row execute function public.protect_profile_billing();
