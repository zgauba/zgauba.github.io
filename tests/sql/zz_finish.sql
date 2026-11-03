-- Always last. Raising here rolls back everything above it, migration included.
do $$
begin
  raise exception 'ALL_TESTS_PASSED (% checks)', coalesce(nullif(current_setting('jc_test.checks', true), ''), '0');
end
$$;
