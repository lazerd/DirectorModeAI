-- /event/<code> for a DEMO club's event forwards to that event's MixerMode
-- page, signed in through the club's demo link, opened on Rounds. The player
-- page is what someone AT the mixer sees; a prospect clicking a link should
-- see the club's side. Real clubs are untouched: no demo_mode, no forward.
CREATE OR REPLACE FUNCTION public.demo_event_forward(p_code text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT '/demo/' || l.token || '/enter?as=director&next=' ||
         replace(replace('/mixer/events/' || e.id::text || '?tab=rounds', '/', '%2F'), '?', '%3F')
    FROM events e
    JOIN cc_clubs c ON c.id = e.club_id AND c.demo_mode = true
    JOIN demo_links l ON l.club_id = c.id
   WHERE upper(e.event_code) = upper(p_code)
   ORDER BY l.created_at
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.demo_event_forward(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.demo_event_forward(text) TO service_role;
