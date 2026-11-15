import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { TeamMessage, TeamRoom } from "../../types";
import { useLanguage } from "../../context/LanguageContext";
import type { TranslationKey } from "../../i18n/translations";
import { getTeamRooms, postTeamMessage } from "../../services/teamService";
import { supabase } from "../../services/supabase";

const ROLE_STYLES: Record<TeamMessage["sender_role"], string> = {
  Moderator: "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200",
  Analyst: "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200",
  Mentor: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  Admin: "bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100",
};
const ROLE_TRANSLATIONS: Record<TeamMessage["sender_role"], TranslationKey> = {
  Moderator: "roleModerator", Analyst: "roleAnalyst", Mentor: "roleMentor", Admin: "roleAdmin",
};

export function TeamChat() {
  const { t, language } = useLanguage();
  const [rooms, setRooms] = useState<TeamRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === selectedRoomId) ?? null,
    [rooms, selectedRoomId],
  );

  useEffect(() => {
    let active = true;
    getTeamRooms()
      .then((nextRooms) => {
        if (!active) return;
        setRooms(nextRooms);
        setSelectedRoomId((current) => current && nextRooms.some((room) => room.id === current)
          ? current
          : nextRooms[0]?.id ?? "");
      })
      .catch(() => {
        if (active) setError(t("teamLoadError"));
      })
      .finally(() => {
        if (active) setLoadingRooms(false);
      });
    return () => { active = false; };
  }, [t]);

  useEffect(() => {
    if (!selectedRoomId) {
      setMessages([]);
      return;
    }
    let active = true;
    setMessages([]);
    setError("");
    setLoadingMessages(true);

    const channel = supabase
      .channel("team-messages-" + selectedRoomId)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "team_messages",
        filter: "team_id=eq." + selectedRoomId,
      }, (payload) => {
        const message = payload.new as unknown as TeamMessage;
        setMessages((current) => mergeMessage(current, message));
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" && active) {
          setError(t("liveUnavailable"));
        }
      });

    supabase
      .from("team_messages")
      .select("id,team_id,sender_role,body,created_at")
      .eq("team_id", selectedRoomId)
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data, error: queryError }) => {
        if (!active) return;
        if (queryError) {
          setError(t("channelMessagesUnavailable"));
          setLoadingMessages(false);
          return;
        }
        const initial = Array.isArray(data) ? [...data].reverse() as TeamMessage[] : [];
        setMessages((current) => mergeMessages(initial, current));
        if (active) setLoadingMessages(false);
      }, () => {
        if (!active) return;
        setError(t("channelMessagesUnavailable"));
        setLoadingMessages(false);
      });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [selectedRoomId, t]);

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = draft.trim();
    if (!selectedRoom || !body || sending) return;
    setSending(true);
    setError("");
    try {
      const message = await postTeamMessage(selectedRoom.id, body);
      setMessages((current) => mergeMessage(current, message));
      setDraft("");
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "invalid_message"
        ? t("invalidMessage")
        : code === "team_scope_required"
          ? t("teamScopeError")
          : code === "rate_limited"
            ? t("chatRateLimited")
            : t("sendMessageError"));
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
        <p className="eyebrow">{t("liveUpdates")}</p>
        <h2 className="m-0 text-xl font-bold text-slate-900 dark:text-slate-100">{t("chatTitle")}</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{t("chatSafety")}</p>
      </div>
      {loadingRooms ? (
        <p className="p-5 text-sm text-slate-600 dark:text-slate-300">{t("loadingChannels")}</p>
      ) : rooms.length === 0 ? (
        <div className="p-5 text-sm text-slate-600 dark:text-slate-300">{t("noChannels")}</div>
      ) : (
        <div className="grid min-h-[420px] md:grid-cols-[220px_minmax(0,1fr)]">
          <nav className="flex gap-2 overflow-x-auto border-b border-slate-200 p-3 md:flex-col md:border-b-0 md:border-r dark:border-slate-700" aria-label={t("teamChannels")}>
            {rooms.map((room) => (
              <button
                key={room.id}
                type="button"
                onClick={() => setSelectedRoomId(room.id)}
                aria-current={selectedRoomId === room.id ? "page" : undefined}
                className={"min-w-max rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors md:min-w-0 " +
                  (selectedRoomId === room.id
                    ? "bg-teal-700 text-white"
                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800")}
              >
                {room.name}
              </button>
            ))}
          </nav>
          <div className="flex min-h-[420px] min-w-0 flex-col">
            <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <h3 className="m-0 text-sm font-bold text-slate-800 dark:text-slate-100">{selectedRoom?.name ?? t("channelFallback")}</h3>
              <p className="m-0 mt-1 text-xs text-slate-500 dark:text-slate-400">
                {selectedRoom?.room_type === "case" ? t("caseRoom") : t("staffChannel")} · {t("liveUpdates")}
              </p>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite" aria-busy={loadingMessages}>
              {loadingMessages && <p className="text-sm text-slate-500 dark:text-slate-400">{t("loadingMessages")}</p>}
              {!loadingMessages && messages.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">{t("noMessages")}</p>}
              {messages.map((message) => (
                <article key={message.id} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className={"rounded-full px-2 py-0.5 text-xs font-bold " + ROLE_STYLES[message.sender_role]}>{t(ROLE_TRANSLATIONS[message.sender_role])}</span>
                    <time className="text-xs text-slate-500 dark:text-slate-400" dateTime={message.created_at}>{formatTime(message.created_at, language)}</time>
                  </div>
                  <p className="m-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800 dark:text-slate-100">{message.body}</p>
                </article>
              ))}
            </div>
            {error && <p className="mx-4 mb-0 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200" role="alert">{error}</p>}
            <form className="border-t border-slate-200 p-3 dark:border-slate-700" onSubmit={send}>
              <label className="sr-only" htmlFor="team-message">{t("writeMessage")}</label>
              <div className="flex items-end gap-2">
                <textarea
                  id="team-message"
                  value={draft}
                  maxLength={2000}
                  rows={2}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={t("messagePlaceholder")}
                  className="min-h-12 flex-1 resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                />
                <button className="button button-primary" type="submit" disabled={!draft.trim() || sending}>
                  {sending ? t("sendingMessage") : t("sendMessage")}
                </button>
              </div>
              <p className="mb-0 mt-2 text-xs text-slate-500 dark:text-slate-400">{draft.length}/2000 · {t("channelCharacterCount")}</p>
            </form>
          </div>
        </div>
      )}
      {error && rooms.length === 0 && <p className="m-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200" role="alert">{error}</p>}
    </section>
  );
}

function mergeMessage(messages: TeamMessage[], incoming: TeamMessage): TeamMessage[] {
  if (messages.some((message) => message.id === incoming.id)) return messages;
  return [...messages, incoming].slice(-100);
}

function mergeMessages(first: TeamMessage[], second: TeamMessage[]): TeamMessage[] {
  return [...first, ...second].reduce<TeamMessage[]>((result, item) => mergeMessage(result, item), []);
}

function formatTime(value: string, language: "en" | "ur"): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(language === "ur" ? "ur-PK" : "en-PK");
}
