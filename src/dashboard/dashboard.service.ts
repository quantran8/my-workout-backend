import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  computeAdherence,
  computeStreak,
  computeVolumeKg,
  toDateString,
} from './dashboard.metrics';
import type {
  DashboardDay,
  DashboardNextSession,
  DashboardRecentSession,
  DashboardResponse,
} from './dashboard.types';

/**
 * Read-only aggregation for the mobile Home screen. Fetches the user's active
 * program (planned days) and their completed sessions, then derives every metric
 * the Home screen renders. No writes, no LLM — the numbers are computed here from
 * source-of-truth rows (WorkoutSession, PlannedSession, LoggedSet, User.tier).
 *
 * Peer contract: mobile `.claude/memory/features/home/home.md`. Keep the wire
 * shape (DashboardResponse) in lockstep with the Dart models it deserializes to.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(userId: string, now = new Date()): Promise<DashboardResponse> {
    // Active program's latest revision → the ordered planned-day sequence. A user
    // mid-onboarding may have none; every field below degrades to empty/null.
    const program = await this.prisma.program.findFirst({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      include: {
        revisions: {
          orderBy: { revisionNumber: 'desc' },
          take: 1,
          include: {
            sessions: {
              orderBy: [{ weekNumber: 'asc' }, { dayNumber: 'asc' }],
              include: { prescriptions: { orderBy: { order: 'asc' } } },
            },
          },
        },
      },
    });
    const plannedDays = program?.revisions[0]?.sessions ?? [];

    // Every completed session, newest first. `startedAt` is the day the work
    // happened; it drives streak, the done-days list, and the recent row.
    const completed = await this.prisma.workoutSession.findMany({
      where: { userId, status: 'completed' },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        plannedSessionId: true,
        startedAt: true,
        endedAt: true,
      },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tier: true },
    });

    // A planned day is "done" once a completed session references it. The first
    // planned day without one is the hero card's next session; everything before
    // it is due. Sessions with no plannedSessionId (ad-hoc logs) still count as
    // completed work but do not consume a planned slot.
    const completedPlannedIds = new Set(
      completed
        .map((s) => s.plannedSessionId)
        .filter((id): id is string => id != null),
    );

    const days: DashboardDay[] = completed
      .filter((s) => s.plannedSessionId != null)
      .map((s) => ({ date: toDateString(s.startedAt), completed: true }))
      .reverse(); // oldest first, to match the mobile SessionLog ordering

    const nextPlanned = plannedDays.find((p) => !completedPlannedIds.has(p.id));

    const done = completed.length;
    // Due = planned slots the user has reached: all completed planned days plus
    // the current next one (the one they are expected to do now). Planned days
    // beyond next are future and not yet due. With no dates on PlannedSession,
    // this reach-based count is the defensible window (see DASHBOARD-3).
    const due = completedPlannedIds.size + (nextPlanned ? 1 : 0);

    const streak = computeStreak(
      completed.map((s) => s.startedAt),
      now,
    );
    const adherence = computeAdherence(done, due);

    const revisionId = program?.revisions[0]?.id;
    const nextSession =
      nextPlanned && revisionId
        ? this.buildNextSession(nextPlanned, revisionId)
        : null;

    const recent = completed[0]
      ? await this.buildRecent(userId, completed[0])
      : null;

    return {
      sessionLog: { days, baselineSessions: done },
      streak,
      adherence,
      due,
      done,
      accessTier: user?.tier === 'PAID' ? 'paid' : 'free',
      nextSession,
      recent,
    };
  }

  private buildNextSession(
    planned: {
      id: string;
      focus: string;
      prescriptions: unknown[];
    },
    programRevisionId: string,
  ): DashboardNextSession {
    return {
      plannedSessionId: planned.id,
      programRevisionId,
      name: planned.focus,
      // No stored per-session duration on PlannedSession; the app's default hero
      // duration is 45 min, so the contract mirrors it rather than inventing one.
      durationMin: 45,
      exercises: planned.prescriptions.length,
    };
  }

  private async buildRecent(
    userId: string,
    session: {
      id: string;
      plannedSessionId: string | null;
      startedAt: Date;
      endedAt: Date | null;
    },
  ): Promise<DashboardRecentSession> {
    const sets = await this.prisma.loggedSet.findMany({
      where: { sessionId: session.id },
      select: { actualWeightKg: true, actualReps: true, exerciseId: true },
    });

    const exerciseIds = new Set(sets.map((s) => s.exerciseId));

    // WorkoutSession.plannedSessionId is a soft FK (no Prisma relation), so the
    // workout name is fetched separately. Ad-hoc sessions (null plannedSessionId)
    // fall back to a generic label the client localizes — never a blank row.
    let name = 'workout';
    if (session.plannedSessionId != null) {
      const planned = await this.prisma.plannedSession.findUnique({
        where: { id: session.plannedSessionId },
        select: { focus: true },
      });
      if (planned) name = planned.focus;
    }

    return {
      sessionId: session.id,
      name,
      volumeKg: computeVolumeKg(sets),
      exercises: exerciseIds.size,
      completedAt: (session.endedAt ?? session.startedAt).toISOString(),
    };
  }
}
