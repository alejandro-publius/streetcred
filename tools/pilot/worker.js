// Dev-only Workers AI image pilot. Never deployed.
//
// Run it with:
//   npx wrangler dev --remote -c tools/pilot/wrangler.jsonc --port 8799
//
// --remote is what makes env.AI real: it runs the code locally against
// Cloudflare's actual bindings rather than a local simulation, which is the
// only way to find out what the models actually render.
//
// One route, one job. POST a base64 frame, a prompt and a model, get an image
// back. No storage of any kind: this Worker has no KV binding, so the pilot
// cannot write to production even if something here were wrong.

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("post an image", { status: 405 });

    const body = await request.json();
    const { model, prompt, frameB64, width = 1024, height = 640, steps } = body;
    if (!model || !prompt) return json({ error: "model and prompt are required" }, 400);

    const started = Date.now();
    try {
      const form = new FormData();
      form.append("prompt", prompt);
      form.append("width", String(width));
      form.append("height", String(height));
      if (steps) form.append("steps", String(steps));

      // The frame the render is conditioned on. Flux 2 wants the input images
      // named input_image_0 upward, each under 512x512, which is why the driver
      // downscales before sending rather than asking the model to cope.
      if (frameB64) {
        const bytes = Uint8Array.from(atob(frameB64), (c) => c.charCodeAt(0));
        form.append("input_image_0", new Blob([bytes], { type: "image/jpeg" }), "frame.jpg");
      }

      // FormData does not expose its serialized body or its boundary. Passing it
      // through a Response is what serializes it and generates the content-type
      // header with the boundary the model's parser needs.
      const packed = new Response(form);
      const out = await env.AI.run(model, {
        multipart: { body: packed.body, contentType: packed.headers.get("content-type") },
      });

      const ms = Date.now() - started;
      // Models return either a base64 string on `image` or a raw stream.
      if (out && typeof out.image === "string") {
        return json({ ok: true, ms, image: out.image, usage: out.usage ?? null });
      }
      if (out instanceof ReadableStream) {
        const buf = await new Response(out).arrayBuffer();
        let bin = "";
        const u8 = new Uint8Array(buf);
        for (let i = 0; i < u8.length; i += 0x8000) {
          bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        }
        return json({ ok: true, ms, image: btoa(bin), usage: null });
      }
      return json({ ok: false, ms, error: "no image in response", shape: Object.keys(out || {}) }, 502);
    } catch (e) {
      return json({ ok: false, ms: Date.now() - started, error: String(e?.message || e).slice(0, 400) }, 502);
    }
  },
};

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
