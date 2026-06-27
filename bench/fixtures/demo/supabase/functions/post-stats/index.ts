// Synthetic demo edge function for the benchmark fixture.
// Returns the comment count for a post via the post_comment_count SQL function.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  const { post_id } = await req.json().catch(() => ({ post_id: 1 }));
  const client = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const { data, error } = await client.rpc("post_comment_count", { p_post_id: post_id });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
  return new Response(JSON.stringify({ post_id, comment_count: data }), {
    headers: { "Content-Type": "application/json" },
  });
});
