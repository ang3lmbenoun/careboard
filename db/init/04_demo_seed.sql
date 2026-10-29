-- Hand-written fake rows to test access control. Phase 2 replaces them.
INSERT INTO clinical.patients (clinic_id, full_name, birth_date, city, primary_condition) VALUES
  (1, 'Test Patient 01', '1958-03-14', 'Fort Worth', 'Hypertension'),
  (1, 'Test Patient 02', '1971-09-02', 'Dallas',     'Type 2 diabetes'),
  (1, 'Test Patient 03', '1984-12-27', 'Fort Worth', 'Asthma'),
  (2, 'Test Patient 04', '1949-06-30', 'Arlington',  'Hypertension'),
  (2, 'Test Patient 05', '1990-01-19', 'Dallas',     'Anxiety'),
  (2, 'Test Patient 06', '1966-08-08', 'Arlington',  'Type 2 diabetes');

INSERT INTO serving.kpi_demo (metric, period, value) VALUES
  ('appointments', '2026-01-01', 1200),
  ('appointments', '2026-02-01', 1175),
  ('appointments', '2026-03-01', 1310),
  ('no_show_rate', '2026-01-01', 0.082),
  ('no_show_rate', '2026-02-01', 0.079),
  ('no_show_rate', '2026-03-01', 0.091);
