// Synthetic demo edge function for the benchmark fixture.
// Returns a friendly greeting.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (req: Request) => {
  const { name } = await req.json().catch(() => ({ name: "world" }));
  return new Response(JSON.stringify({ message: `Hello ${name ?? "world"}!` }), {
    headers: { "Content-Type": "application/json" },
  });
});
