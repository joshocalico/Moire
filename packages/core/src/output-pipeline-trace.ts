/** Bounded output metadata only: no client strings, pixels or credential transport. */
type OutputPipelineEvent =
  | {
      stage: "commit";
      client: number;
      surface: number;
      revision: number;
      sourceAccepted: boolean;
      damageRects: number;
      callbacks: number;
    }
  | {
      stage: "scene";
      frame: number;
      client: number;
      surface: number;
      revision: number;
      damageRects: number;
      callbacks: number;
    }
  | { stage: "gpu"; damagePixels: number }
  | { stage: "submitted"; frame: number; output: number; framebuffer: number }
  | { stage: "scanout"; frame: number; output: number; accepted: boolean };
let records = 0;
export function traceOutputPipeline(event: OutputPipelineEvent): void {
  if (process.env.MOIRE_OUTPUT_PIPELINE_TRACE !== "1" || records >= 256) return;
  records++;
  console.log(`[output-pipeline] ${JSON.stringify({ record: records, ...event })}`);
}
