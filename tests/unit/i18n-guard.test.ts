import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (p === join(root, "app", "api")) return [];
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(name) ? [p] : [];
  });
}

const files = ["app", "components", "lib"]
  .flatMap((d) => walk(join(root, d)))
  .map((p) => ({ path: p.slice(root.length + 1).split(sep).join("/"), text: readFileSync(p, "utf8") }));

const offenders = (fn: (text: string) => boolean) => files.filter((f) => fn(f.text)).map((f) => f.path);

describe("i18n guard", () => {
  it("no next/link imports", () => {
    expect(offenders((t) => t.includes('from "next/link"'))).toEqual([]);
  });

  it("no locale-unaware navigation", () => {
    const re = /import\s*\{([^}]*)\}\s*from\s*"next\/navigation"/g;
    expect(
      offenders((t) =>
        [...t.matchAll(re)].some((m) => /\b(useRouter|usePathname|redirect)\b/.test(m[1])),
      ),
    ).toEqual([]);
  });

  it("refresh calls cover every locale", () => {
    expect(
      offenders((t) =>
        [...t.matchAll(/revalidatePath\(\s*"([^"]*)"/g)].some(
          (m) => m[1] !== "/" && !m[1].startsWith("/[locale]/"),
        ),
      ),
    ).toEqual([]);
  });

  it("locale revalidatePath patterns match a real route key (route groups included)", () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const m of f.text.matchAll(/revalidatePath\(\s*"(\/\[locale\][^"]*)"\s*,\s*"(page|layout)"/g)) {
        const dir = join(root, "app", m[1]);
        // layout type may name a plain segment folder (prefix match), page needs page.tsx
        const ok = m[2] === "page" ? existsSync(join(dir, "page.tsx")) : existsSync(dir);
        if (!ok) bad.push(`${f.path}: ${m[1]} (${m[2]})`);
      }
    }
    expect(bad).toEqual([]);
  });
});
