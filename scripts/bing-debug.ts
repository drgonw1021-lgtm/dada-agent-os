// Debug: dump Bing HTML to inspect actual structure
import { createAgentApp } from "../src/app.js";

async function main() {
  const query = "pet supplies market";
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

  const resp = await fetch(
    `https://cn.bing.com/search?q=${encodeURIComponent(query)}&count=10&ensearch=0`,
    { headers: { "User-Agent": ua, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" } }
  );
  console.log(`Status: ${resp.status}, Content-Type: ${resp.headers.get("content-type")}`);
  const html = await resp.text();
  console.log(`HTML length: ${html.length}`);

  // Save to file for inspection
  const fs = await import("node:fs/promises");
  await fs.writeFile("./bing-debug.html", html.substring(0, 50000));
  console.log("Saved first 50KB to bing-debug.html");

  // Quick check: find all b_algo blocks
  const matches = html.match(/class="b_algo"/g);
  console.log(`b_algo occurrences: ${matches?.length || 0}`);

  // Find H2 tags with links
  const h2Matches = html.match(/<h2[^>]*>/g);
  console.log(`H2 tags: ${h2Matches?.length || 0}`);

  // Show first 5 H2 tags
  if (h2Matches) {
    for (let i = 0; i < Math.min(5, h2Matches.length); i++) {
      console.log(`  H2 #${i}: ${h2Matches[i].substring(0, 150)}`);
    }
  }

  // Try the block regex
  const blockRegex = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
  let blockCount = 0;
  let bm;
  while ((bm = blockRegex.exec(html)) !== null) {
    blockCount++;
    if (blockCount <= 2) {
      // Check first block for title link
      const titleMatch = bm[1].match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      const anyLink = bm[1].match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>/g);
      console.log(`  Block #${blockCount}: h2-link=${!!titleMatch}, any-links=${anyLink?.length || 0}`);
      if (anyLink) {
        for (const link of anyLink.slice(0, 3)) {
          console.log(`    ${link.substring(0, 120)}`);
        }
      }
    }
  }
  console.log(`Total b_algo blocks: ${blockCount}`);

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
