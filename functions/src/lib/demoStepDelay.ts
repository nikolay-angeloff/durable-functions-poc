/**
 * Artificial delay so the demo UI can show each orchestration step for ~4–5 seconds.
 * Only used in mock step activities (not in production paths you would ship as-is).
 */
export async function demoStepDelayMs(): Promise<void> {
    const ms = 4000 + Math.floor(Math.random() * 1001);
    await new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });
}
