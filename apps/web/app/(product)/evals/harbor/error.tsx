"use client";
export default function ErrorView({ reset }: { reset: () => void }) { return <div className="grid gap-3 p-6"><p role="alert">Harbor tasks could not be loaded.</p><button className="justify-self-start rounded-md border border-border px-3 py-2" onClick={reset}>Try again</button></div>; }
