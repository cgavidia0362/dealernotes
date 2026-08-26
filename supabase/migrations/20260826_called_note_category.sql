-- Allow Called as a dealer_notes category (Visit/Visited/Problem/Other/Manager stay valid).

do $$
declare
  enum_name text;
  r record;
begin
  select t.typname into enum_name
  from pg_type t
  join pg_attribute a on a.atttypid = t.oid
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where c.relname = 'dealer_notes'
    and n.nspname = 'public'
    and a.attname = 'category'
    and t.typtype = 'e';

  if enum_name is not null then
    execute format('alter type %I add value if not exists %L', enum_name, 'Called');
    return;
  end if;

  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where rel.relname = 'dealer_notes'
      and nsp.nspname = 'public'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%category%'
  loop
    execute format('alter table public.dealer_notes drop constraint %I', r.conname);
  end loop;

  begin
    alter table public.dealer_notes
      add constraint dealer_notes_category_check
      check (category in ('Visit', 'Visited', 'Called', 'Problem', 'Other', 'Manager'));
  exception
    when duplicate_object then null;
  end;
end $$;
