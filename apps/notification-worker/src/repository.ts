import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../packages/cassandra/src/index.js";
import type { Notification } from "./model.js";

const uuid = (value: string) => types.Uuid.fromString(value);
const monthDate = (value: string) => types.LocalDate.fromString(`${value}-01`);

export class NotificationRepository {
  public constructor(private readonly db: CassandraClient) {}

  async reserve(eventId: string, userId: string, notificationId: string, createdAt: Date): Promise<boolean> {
    const rows = await this.db.execute(
      "INSERT INTO notification_dedup_by_event_user (event_id,user_id,notification_id,state,created_at) VALUES (?,?,?,'RESERVED',?) IF NOT EXISTS",
      [uuid(eventId), uuid(userId), uuid(notificationId), createdAt],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return rows[0]?.["[applied]"] === true;
  }

  async dedup(eventId: string, userId: string) {
    return (
      await this.db.execute(
        "SELECT notification_id,state,created_at FROM notification_dedup_by_event_user WHERE event_id=? AND user_id=?",
        [uuid(eventId), uuid(userId)],
        "LOCAL_QUORUM",
      )
    )[0];
  }

  async materialize(value: Notification): Promise<void> {
    await this.db.execute(
      "INSERT INTO notifications_by_user_bucket (user_id,year_month,created_at,notification_id,event_id,type,title,body,read_at,source_type,source_id,source_context_id) VALUES (?,?,?,?,?,?,?,?,null,?,?,?) IF NOT EXISTS",
      [
        uuid(value.userId),
        monthDate(value.createdAt.toISOString().slice(0, 7)),
        value.createdAt,
        uuid(value.notificationId),
        uuid(value.eventId),
        value.type,
        value.title,
        value.body,
        value.sourceType,
        uuid(value.sourceId),
        uuid(value.sourceContextId),
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
  }

  async complete(eventId: string, userId: string): Promise<void> {
    await this.db.execute(
      "UPDATE notification_dedup_by_event_user SET state='MATERIALIZED' WHERE event_id=? AND user_id=? IF state='RESERVED'",
      [uuid(eventId), uuid(userId)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
  }

  async list(userId: string, month: string, limit: number, pageState?: string) {
    const page = await this.db.executePage(
      "SELECT * FROM notifications_by_user_bucket WHERE user_id=? AND year_month=?",
      [uuid(userId), monthDate(month)],
      "LOCAL_QUORUM",
      limit,
      pageState,
    );
    return {
      items: page.rows.map((row) => fromRow(row)),
      ...(page.pageState ? { pageState: page.pageState } : {}),
    };
  }

  async get(
    userId: string,
    month: string,
    createdAt: Date,
    notificationId: string,
  ): Promise<Notification | undefined> {
    const row = (
      await this.db.execute(
        "SELECT * FROM notifications_by_user_bucket WHERE user_id=? AND year_month=? AND created_at=? AND notification_id=?",
        [uuid(userId), monthDate(month), createdAt, uuid(notificationId)],
        "LOCAL_QUORUM",
      )
    )[0];
    return row ? fromRow(row) : undefined;
  }

  async markRead(
    userId: string,
    month: string,
    createdAt: Date,
    notificationId: string,
    readAt: Date,
  ): Promise<void> {
    await this.db.execute(
      "UPDATE notifications_by_user_bucket SET read_at=? WHERE user_id=? AND year_month=? AND created_at=? AND notification_id=? IF read_at=null",
      [readAt, uuid(userId), monthDate(month), createdAt, uuid(notificationId)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
  }
}

function fromRow(row: Record<string, unknown>): Notification {
  return {
    userId: String(row.user_id),
    notificationId: String(row.notification_id),
    eventId: String(row.event_id),
    type: String(row.type) as Notification["type"],
    title: String(row.title),
    body: String(row.body),
    sourceType: String(row.source_type),
    sourceId: String(row.source_id),
    sourceContextId: String(row.source_context_id),
    createdAt: new Date(String(row.created_at)),
    ...(row.read_at ? { readAt: dateValue(row.read_at) } : {}),
  };
}

function dateValue(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") return new Date(value);
  throw new Error("INVALID_NOTIFICATION_DATE");
}
