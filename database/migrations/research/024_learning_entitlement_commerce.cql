-- P7.17 Q-LRN-008/Q-LRN-022 canonical entitlement and Offering enrollment.
CREATE TABLE IF NOT EXISTS learning_keyspace.entitlement_by_student_course (
  student_id uuid,
  course_id uuid,
  entitlement_id uuid,
  state text,
  source_offering_id uuid,
  source_enrollment_id uuid,
  granted_at timestamp,
  version bigint,
  updated_at timestamp,
  PRIMARY KEY ((student_id, course_id))
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.enrollment_by_student_offering (
  student_id uuid,
  offering_id uuid,
  enrollment_id uuid,
  course_id uuid,
  offering_type text,
  class_id uuid,
  state text,
  entitlement_state text,
  order_id uuid,
  schedule_reservation_id uuid,
  membership_id uuid,
  enrolled_at timestamp,
  version bigint,
  updated_at timestamp,
  PRIMARY KEY ((student_id, offering_id))
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

ALTER TABLE learning_keyspace.order_by_id ADD IF NOT EXISTS offering_id uuid;
ALTER TABLE learning_keyspace.order_by_id ADD IF NOT EXISTS offering_type text;
ALTER TABLE learning_keyspace.order_by_id ADD IF NOT EXISTS class_id uuid;
ALTER TABLE learning_keyspace.order_by_id ADD IF NOT EXISTS schedule_reservation_id uuid;
ALTER TABLE learning_keyspace.order_by_id ADD IF NOT EXISTS reservation_operation_id uuid;
ALTER TABLE learning_keyspace.order_by_id ADD IF NOT EXISTS enrollment_id uuid;
ALTER TABLE learning_keyspace.order_by_id ADD IF NOT EXISTS membership_id uuid;
ALTER TABLE learning_keyspace.order_by_id ADD IF NOT EXISTS operation_id uuid;
ALTER TABLE learning_keyspace.order_by_id ADD IF NOT EXISTS paid_event_id uuid;
ALTER TABLE learning_keyspace.order_by_id ADD IF NOT EXISTS enrolled_event_id uuid;
ALTER TABLE learning_keyspace.order_by_id ADD IF NOT EXISTS fulfillment_state text;
ALTER TABLE learning_keyspace.order_by_id ADD IF NOT EXISTS compensation_reason text;
ALTER TABLE learning_keyspace.order_by_id ADD IF NOT EXISTS correlation_id uuid;
ALTER TABLE learning_keyspace.order_by_id ADD IF NOT EXISTS paid_at timestamp;
