import { getLocale, t } from "@shared/l10n";
import type { CronJobInfo } from "@shared/types";
import cronstrue from "cronstrue";
import "cronstrue/locales/zh_CN";
import { useCallback, useEffect, useState } from "react";
import { cls } from "reactutils";
import { appStore } from "../../../../app-store";
import { Button } from "../../../button";
import { IconChat, IconTrash } from "../../../icons";
import { Modal } from "../../../modal";
import "./index.css";

export interface EmployeeCronJobsProps {
  employeeId: number;
}

/** Descriptions longer than this render clamped with an expand toggle. */
const DESCRIPTION_CLAMP_CHARS = 120;

/** Map the app locale (`en` / `zh-CN`) to a cronstrue locale name. */
function cronstrueLocale(locale: string): string {
  return locale === "zh-CN" ? "zh_CN" : "en";
}

/** Plain-language schedule text; falls back to the raw expression on failure. */
function describeSchedule(schedule: string): string {
  try {
    return cronstrue.toString(schedule, {
      locale: cronstrueLocale(getLocale()),
      use24HourTimeFormat: true,
    });
  } catch {
    return schedule;
  }
}

/** Locale-aware absolute next-run time; `null` means no known next run. */
function formatNextRun(at: number | null): string {
  if (at === null) return t("Not scheduled");
  try {
    return new Intl.DateTimeFormat(getLocale(), {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(at * 1000));
  } catch {
    return new Date(at * 1000).toLocaleString();
  }
}

/**
 * List of an employee's cron jobs for the detail pane. Renders nothing when
 * the employee has none. Jobs can be opened (chat) and removed (confirmed).
 */
export function EmployeeCronJobs({
  employeeId,
}: EmployeeCronJobsProps): React.JSX.Element | null {
  const [jobs, setJobs] = useState<CronJobInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [removing, setRemoving] = useState<CronJobInfo | null>(null);
  const [removingBusy, setRemovingBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setJobs(await imb.cron.listByEmployee(employeeId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleExpanded = useCallback((id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Root chats open in the Chat module; spawned group chats open in the
  // Group chat module (both routed through appStore).
  const openChat = useCallback(async (chatId: number): Promise<void> => {
    try {
      const summary = await imb.chats.summary(chatId);
      if (summary === null) return;
      if (summary.fromChatId === null) {
        await appStore.focusChat(chatId);
      } else {
        appStore.openChat(summary);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const confirmRemove = useCallback(async (): Promise<void> => {
    if (removing === null) return;
    setRemovingBusy(true);
    try {
      const removed = await imb.cron.remove(removing.id);
      if (removed) {
        setJobs((prev) => prev.filter((job) => job.id !== removing.id));
      }
      setRemoving(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemovingBusy(false);
    }
  }, [removing]);

  if (loading) return null;

  if (jobs.length === 0) {
    return error !== null ? <p className="imb-error-text">{error}</p> : null;
  }

  return (
    <>
      <div className="imb-field imb-cron-section">
        <label>{t("Scheduled tasks")}</label>
        <div className="imb-cron-list">
          {jobs.map((job) => {
            const isExpanded = expanded.has(job.id);
            const canExpand = job.content.length > DESCRIPTION_CLAMP_CHARS;
            return (
              <div className="imb-cron-item" key={job.id}>
                <button
                  type="button"
                  className="imb-cron-remove"
                  title={t("Remove scheduled task")}
                  aria-label={t("Remove scheduled task")}
                  onClick={() => setRemoving(job)}
                >
                  <IconTrash />
                </button>
                <dl className="imb-cron-meta">
                  <div className="imb-cron-meta-row">
                    <dt>{t("Chat")}</dt>
                    <dd>
                      <button
                        type="button"
                        className="imb-cron-chat"
                        title={t("Open chat")}
                        onClick={() => void openChat(job.chatId)}
                      >
                        <IconChat />
                        <span>{job.chatTitle || t("Untitled")}</span>
                      </button>
                    </dd>
                  </div>
                  <div className="imb-cron-meta-row">
                    <dt>{t("Schedule")}</dt>
                    <dd className="imb-cron-schedule">
                      <span className="imb-cron-schedule-text">
                        {describeSchedule(job.schedule)}
                      </span>
                      <code className="imb-cron-schedule-raw">
                        {job.schedule}
                      </code>
                    </dd>
                  </div>
                  <div className="imb-cron-meta-row">
                    <dt>{t("Description")}</dt>
                    <dd>
                      <div
                        className={cls(
                          "imb-cron-desc",
                          isExpanded && "imb-is-expanded",
                        )}
                      >
                        {job.content}
                      </div>
                      {canExpand && (
                        <button
                          type="button"
                          className="imb-cron-toggle"
                          onClick={() => toggleExpanded(job.id)}
                        >
                          {isExpanded ? t("Show less") : t("Show more")}
                        </button>
                      )}
                    </dd>
                  </div>
                  <div className="imb-cron-meta-row">
                    <dt>{t("Next run")}</dt>
                    <dd className="imb-cron-next">
                      {formatNextRun(job.nextRunAt)}
                    </dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>
      </div>

      {error !== null && (
        <p className="imb-error-text imb-cron-error">{error}</p>
      )}

      <Modal
        open={removing !== null}
        onClose={() => {
          if (!removingBusy) setRemoving(null);
        }}
        title={t("Remove scheduled task")}
        actions={
          <>
            <Button
              variant="secondary"
              disabled={removingBusy}
              onClick={() => setRemoving(null)}
            >
              {t("Cancel")}
            </Button>
            <Button
              variant="danger"
              loading={removingBusy}
              onClick={() => void confirmRemove()}
            >
              {t("Remove")}
            </Button>
          </>
        }
      >
        <p className="imb-module-note">
          {t("This scheduled task will be removed. This cannot be undone.")}
        </p>
      </Modal>
    </>
  );
}
