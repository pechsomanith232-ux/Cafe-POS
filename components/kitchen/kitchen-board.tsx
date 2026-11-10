"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { setKitchenStatusAction } from "@/app/kitchen/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { elapsedTone } from "@/lib/pos/kitchen";
import type { KitchenTicket } from "@/lib/queries/pos";
import { cn } from "@/lib/utils";

type Station = "all" | "bar" | "kitchen";
type Ticket = Omit<KitchenTicket, "sentAt" | "lines"> & { sentAt: string; lines: (Omit<KitchenTicket["lines"][number], "sentAt"> & { sentAt: string })[] };
const NEXT: Record<string, { to: string; label: string }> = {
  pending: { to: "preparing", label: "Start" },
  preparing: { to: "ready", label: "Ready" },
  ready: { to: "served", label: "Served" },
};


// A short beep for new orders (no audio file needed). One AudioContext, reused.
let audio: AudioContext | null = null;
function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audio ??= new Ctx();
    const ac = audio;
    void ac.resume();
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.2, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.35);
    o.connect(g).connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + 0.35);
  } catch { /* audio blocked: ignore */ }
}

export function KitchenBoard({ branchId, branchName }: { branchId: string; branchName: string }) {
  const qc = useQueryClient();
  const [station, setStation] = useState<Station>("all");
  const [sound, setSound] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const seen = useRef<Set<string> | null>(null);
  const key = ["kitchen", branchId, station];
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const r = await fetch(`/api/kitchen?branch=${branchId}${station === "all" ? "" : `&station=${station}`}`, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "Couldn't load the kitchen queue.");
      return (await r.json()) as { tickets: Ticket[]; now: string };
    },
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 10_000); return () => clearInterval(t); }, []);
  // Beep when a line we haven't seen arrives (not on the first load, not when staff
  // move or serve lines themselves).
  useEffect(() => {
    if (!data) return;
    const ids = data.tickets.flatMap((t) => t.lines.map((l) => l.id));
    if (seen.current && sound && ids.some((id) => !seen.current!.has(id))) beep();
    seen.current = new Set([...(seen.current ?? []), ...ids]);
  }, [data, sound]);
  useEffect(() => { seen.current = null; }, [station]);

  const move = async (lineId: string, to: string) => {
    const r = await setKitchenStatusAction(lineId, to);
    if (!r.ok) return void toast.error(r.error);
    qc.invalidateQueries({ queryKey: ["kitchen", branchId] });
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="flex items-center gap-3 border-b bg-background px-4 py-2">
        <Button asChild variant="ghost" size="icon" aria-label="Back to POS"><Link href="/pos"><ArrowLeft /></Link></Button>
        <span className="font-semibold">Kitchen · {branchName}</span>
        <div className="ml-4 flex gap-1">
          {(["all", "bar", "kitchen"] as const).map((s) => (
            <Button key={s} size="sm" variant={station === s ? "default" : "outline"} onClick={() => setStation(s)}>{s === "all" ? "All" : s === "bar" ? "Bar" : "Kitchen"}</Button>
          ))}
        </div>
        <Button variant="ghost" size="icon" className="ml-auto" aria-label={sound ? "Mute" : "Unmute"} onClick={() => setSound(!sound)}>{sound ? <Volume2 /> : <VolumeX />}</Button>
      </header>
      {error && <p className="p-4 text-sm text-destructive">{(error as Error).message}</p>}
      <main className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3 p-3">
        {data?.tickets.length === 0 && <p className="col-span-full p-10 text-center text-muted-foreground">Nothing to make right now.</p>}
        {data?.tickets.map((t) => {
          const tone = elapsedTone(now - new Date(t.sentAt).getTime());
          const mins = Math.max(0, Math.floor((now - new Date(t.sentAt).getTime()) / 60_000));
          return (
            <article key={t.orderId} data-testid="kitchen-ticket" className={cn("flex flex-col rounded-lg border-2 bg-background", tone === "green" && "border-emerald-500", tone === "amber" && "border-amber-500", tone === "red" && "border-red-600")}>
              <div className={cn("flex items-center justify-between px-3 py-2 text-sm font-semibold", tone === "green" && "bg-emerald-50", tone === "amber" && "bg-amber-50", tone === "red" && "bg-red-50")}>
                <span className="text-lg">#{t.queueNo}</span>
                <span>{t.orderType === "dine_in" ? `Dine-in${t.tableName ? ` · ${t.tableName}` : ""}` : "Takeaway"}</span>
                <span className="tabular-nums">{mins} min</span>
              </div>
              <ul className="divide-y">
                {t.lines.map((l) => (
                  <li key={l.id} className="flex items-start gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{l.qty} × {l.productName}{l.variantName !== l.productName && ` · ${l.variantName}`}</div>
                      {l.modifiers.length > 0 && <div className="text-sm text-muted-foreground">{l.modifiers.join(", ")}</div>}
                      {l.note && <div className="text-sm italic">“{l.note}”</div>}
                      <Badge variant="outline" className="mt-1 capitalize">{l.status}</Badge>
                    </div>
                    {NEXT[l.status] && <Button size="sm" className="h-10" onClick={() => move(l.id, NEXT[l.status].to)}>{NEXT[l.status].label}</Button>}
                  </li>
                ))}
              </ul>
              <div className="mt-auto px-3 py-1.5 text-xs text-muted-foreground">{t.orderNo}</div>
            </article>
          );
        })}
      </main>
    </div>
  );
}
