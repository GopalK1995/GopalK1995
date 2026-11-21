-- T046: extra Booking fields for tenants that already have a booking object type (no-op when none). Idempotent.
insert into public.field_defs (tenant_id, object_type_id, key, label, type, options, required, is_filterable, is_pii, section, position)
select o.tenant_id, o.id, f.key, jsonb_build_object('en', f.label), f.type, f.options::jsonb, false, f.filterable, f.pii, 'stay', f.pos
  from public.object_types o
  cross join (values
    ('status',            'Status',            'select', '{"choices":[{"key":"confirmed","label":"Confirmed"},{"key":"cancelled","label":"Cancelled"}]}', true,  false, 7),
    ('entry',             'Entry',             'select', '{"choices":[{"key":"reservation","label":"Reservation"},{"key":"block","label":"Calendar block"}]}', true,  false, 8),
    ('ota_channel',       'Channel',           'text',   '{}', true,  false, 9),
    ('external_ref',      'Channel reference', 'text',   '{}', false, false, 10),
    ('total_amount',      'Total',             'money',  '{}', false, false, 11),
    ('currency',          'Currency',          'text',   '{}', false, false, 12),
    ('commission_amount', 'Commission',        'money',  '{}', false, false, 13),
    ('guest_name',        'Guest',             'text',   '{}', false, true,  14)
  ) f(key, label, type, options, filterable, pii, pos)
 where o.key = 'booking'
on conflict (object_type_id, key) do nothing;
