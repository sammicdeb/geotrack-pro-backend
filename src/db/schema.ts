import {
  pgTable, pgEnum, text, boolean, timestamp, doublePrecision,
  integer, jsonb, primaryKey, uniqueIndex, index, uuid,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ─── Enums ────────────────────────────────────────────────────────────────────
export const roleEnum = pgEnum('role', ['super_admin', 'admin', 'supervisor', 'field_agent', 'viewer']);
export const accountStatusEnum = pgEnum('account_status', ['active', 'inactive', 'suspended']);
export const zoneShapeEnum = pgEnum('zone_shape', ['polygon', 'circle']);
export const zoneStatusEnum = pgEnum('zone_status', ['active', 'inactive']);
export const alertTypeEnum = pgEnum('alert_type', ['entry', 'exit', 'violation', 'sos', 'admin_message']);
export const alertSeverityEnum = pgEnum('alert_severity', ['info', 'warning', 'critical']);
export const checkInTypeEnum = pgEnum('check_in_type', ['check_in', 'check_out']);

// ─── Organizations ────────────────────────────────────────────────────────────
export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  email: text('email').notNull().unique(),
  logoUrl: text('logo_url'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Users ────────────────────────────────────────────────────────────────────
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email').notNull(),
  username: text('username').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').default('field_agent').notNull(),
  status: accountStatusEnum('status').default('active').notNull(),
  avatarUrl: text('avatar_url'),
  lastLatitude: doublePrecision('last_latitude'),
  lastLongitude: doublePrecision('last_longitude'),
  lastSeenAt: timestamp('last_seen_at'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('users_org_username_idx').on(t.organizationId, t.username),
  uniqueIndex('users_org_email_idx').on(t.organizationId, t.email),
  index('users_org_idx').on(t.organizationId),
]);

// ─── Zones ────────────────────────────────────────────────────────────────────
export const zones = pgTable('zones', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  shape: zoneShapeEnum('shape').notNull(),
  coordinates: jsonb('coordinates').notNull(),
  radius: doublePrecision('radius'),
  color: text('color').default('#3B82F6').notNull(),
  fillOpacity: doublePrecision('fill_opacity').default(0.2).notNull(),
  status: zoneStatusEnum('status').default('active').notNull(),
  scheduleEnabled: boolean('schedule_enabled').default(false).notNull(),
  scheduleDays: integer('schedule_days').array().default([]).notNull(),
  scheduleStart: text('schedule_start'),
  scheduleEnd: text('schedule_end'),
  scheduleTimezone: text('schedule_timezone'),
  source: text('source').default('drawn').notNull(),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('zones_org_idx').on(t.organizationId),
]);

// ─── Zone Assignments ─────────────────────────────────────────────────────────
export const zoneAssignments = pgTable('zone_assignments', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  zoneId: uuid('zone_id').notNull().references(() => zones.id, { onDelete: 'cascade' }),
  assignedAt: timestamp('assigned_at').defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.zoneId] }),
]);

// ─── Alerts ───────────────────────────────────────────────────────────────────
export const alerts = pgTable('alerts', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  type: alertTypeEnum('type').notNull(),
  severity: alertSeverityEnum('severity').default('info').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  zoneId: uuid('zone_id').references(() => zones.id, { onDelete: 'set null' }),
  message: text('message').notNull(),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  read: boolean('read').default(false).notNull(),
  acknowledged: boolean('acknowledged').default(false).notNull(),
  acknowledgedBy: uuid('acknowledged_by'),
  acknowledgedAt: timestamp('acknowledged_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('alerts_org_idx').on(t.organizationId),
  index('alerts_user_idx').on(t.userId),
]);

// ─── CheckIns ─────────────────────────────────────────────────────────────────
export const checkIns = pgTable('check_ins', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull(),
  type: checkInTypeEnum('type').notNull(),
  latitude: doublePrecision('latitude').notNull(),
  longitude: doublePrecision('longitude').notNull(),
  zoneId: uuid('zone_id').references(() => zones.id, { onDelete: 'set null' }),
  note: text('note'),
  durationSeconds: integer('duration_seconds'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('checkins_org_idx').on(t.organizationId),
  index('checkins_user_idx').on(t.userId),
]);

// ─── Audit Logs ───────────────────────────────────────────────────────────────
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  performedById: uuid('performed_by_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  targetId: uuid('target_id'),
  targetType: text('target_type'),
  targetName: text('target_name'),
  metadata: jsonb('metadata').default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('audit_org_idx').on(t.organizationId),
]);

// ─── Refresh Tokens ───────────────────────────────────────────────────────────
export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  token: text('token').notNull().unique(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('refresh_tokens_user_idx').on(t.userId),
]);

// ─── Relations ────────────────────────────────────────────────────────────────
export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(users),
  zones: many(zones),
  alerts: many(alerts),
  checkIns: many(checkIns),
  auditLogs: many(auditLogs),
  refreshTokens: many(refreshTokens),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, { fields: [users.organizationId], references: [organizations.id] }),
  assignedZones: many(zoneAssignments),
  alerts: many(alerts),
  checkIns: many(checkIns),
  auditLogs: many(auditLogs),
  refreshTokens: many(refreshTokens),
}));

export const zonesRelations = relations(zones, ({ one, many }) => ({
  organization: one(organizations, { fields: [zones.organizationId], references: [organizations.id] }),
  assignedUsers: many(zoneAssignments),
  alerts: many(alerts),
  checkIns: many(checkIns),
}));

export const zoneAssignmentsRelations = relations(zoneAssignments, ({ one }) => ({
  user: one(users, { fields: [zoneAssignments.userId], references: [users.id] }),
  zone: one(zones, { fields: [zoneAssignments.zoneId], references: [zones.id] }),
}));

export const alertsRelations = relations(alerts, ({ one }) => ({
  organization: one(organizations, { fields: [alerts.organizationId], references: [organizations.id] }),
  user: one(users, { fields: [alerts.userId], references: [users.id] }),
  zone: one(zones, { fields: [alerts.zoneId], references: [zones.id] }),
}));

export const checkInsRelations = relations(checkIns, ({ one }) => ({
  organization: one(organizations, { fields: [checkIns.organizationId], references: [organizations.id] }),
  user: one(users, { fields: [checkIns.userId], references: [users.id] }),
  zone: one(zones, { fields: [checkIns.zoneId], references: [zones.id] }),
}));
