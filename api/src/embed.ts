import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

// Small local embedding model (384 dimensions). It loads on first use, so memory is only spent when someone searches policies.
// The first search after a restart downloads the model (about 25 MB) if it is not cached yet.
export const EMBED_DIMS = 384;
const MODEL = process.env.EMBED_MODEL ?? "Xenova/all-MiniLM-L6-v2";

let loading: Promise<FeatureExtractionPipeline> | null = null;
function load() {
  loading ??= (pipeline("feature-extraction", MODEL, { dtype: "q8" }) as Promise<FeatureExtractionPipeline>).catch((e) => {
    loading = null; // allow a retry on the next call
    throw e;
  });
  return loading;
}

export async function embed(text: string): Promise<number[]> {
  const ex = await load();
  const out = await ex(text, { pooling: "mean", normalize: true });
  const v = Array.from(out.data as Float32Array);
  if (v.length !== EMBED_DIMS) throw new Error(`embedding has ${v.length} dimensions, expected ${EMBED_DIMS}`);
  return v;
}

// pgvector accepts a bracketed list as text.
export const toVector = (v: number[]) => "[" + v.map((x) => x.toFixed(6)).join(",") + "]";
