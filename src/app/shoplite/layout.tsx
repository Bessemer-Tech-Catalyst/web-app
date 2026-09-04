/**
 * ShopLite's shell. Deliberately looks nothing like The Odyssey: on stage it has to be
 * obvious at a glance that the thing being tested is a different application from the
 * thing doing the testing.
 *
 * Styles are inline here rather than in `globals.css` for the same reason — this app's
 * appearance must not drift when the product's design system does.
 */

import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./shop";
import { readFlags } from "./shop-state";

export const metadata = { title: "ShopLite" };

export default async function ShopLiteLayout({ children }: { children: React.ReactNode }) {
  const email = (await cookies()).get(SESSION_COOKIE)?.value;
  // The `drift` switch is a copy change, and a copy change is not confined to one
  // button: it renames the concept everywhere it appears. The nav is where it bites
  // hardest, because a generated test reaches most pages through a named link.
  const { drift } = await readFlags();

  return (
    <div className="sl">
      <style>{CSS}</style>
      <header className="sl-bar">
        <Link href="/shoplite" className="sl-brand">
          ShopLite
        </Link>
        <nav className="sl-nav">
          <Link href="/shoplite/products">Products</Link>
          <Link href="/shoplite/basket">{drift ? "Bag" : "Basket"}</Link>
          <Link href="/shoplite/orders">Orders</Link>
        </nav>
        <span className="sl-who">{email ? email : "Signed out"}</span>
      </header>
      <main className="sl-main">{children}</main>
    </div>
  );
}

const CSS = `
.sl { min-height: 100vh; background: #fbfaf8; color: #1c1b19;
  font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.sl a { color: inherit; text-decoration: none; }
.sl-bar { display: flex; align-items: center; gap: 28px; padding: 14px 28px;
  border-bottom: 1px solid #e6e1d8; background: #fff; }
.sl-brand { font-weight: 700; letter-spacing: -0.01em; font-size: 17px; }
.sl-nav { display: flex; gap: 20px; font-size: 14px; }
.sl-nav a:hover { text-decoration: underline; }
.sl-who { margin-left: auto; font-size: 13px; color: #6f6a61; }
.sl-main { max-width: 940px; margin: 0 auto; padding: 32px 28px 64px; }
.sl h1 { font-size: 24px; letter-spacing: -0.02em; margin: 0 0 4px; }
.sl h2 { font-size: 17px; margin: 0 0 10px; }
.sl p.sl-lede { color: #6f6a61; margin: 0 0 26px; }
.sl-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.sl-card { border: 1px solid #e6e1d8; border-radius: 10px; background: #fff; padding: 18px; }
.sl-card h3 { margin: 0 0 4px; font-size: 15px; }
.sl-card .sl-blurb { color: #6f6a61; font-size: 13px; margin: 0 0 14px; }
.sl-price { font-variant-numeric: tabular-nums; font-weight: 600; }
.sl-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.sl-btn { border: 1px solid #1c1b19; background: #1c1b19; color: #fff; border-radius: 7px;
  padding: 8px 14px; font-size: 14px; cursor: pointer; }
.sl-btn:hover { background: #35322d; }
.sl-btn[disabled] { opacity: 0.45; cursor: default; }
.sl-btn-quiet { background: #fff; color: #1c1b19; }
.sl-btn-quiet:hover { background: #f2efe9; }
.sl-field { display: block; margin-bottom: 14px; }
.sl-field span { display: block; font-size: 13px; margin-bottom: 5px; color: #45423d; }
.sl-field input { width: 100%; padding: 9px 11px; border: 1px solid #d9d3c8; border-radius: 7px;
  font-size: 14px; background: #fff; }
.sl-error { color: #a3231a; background: #fdf0ef; border: 1px solid #f2cfcb;
  border-radius: 7px; padding: 10px 12px; font-size: 14px; margin-bottom: 16px; }
.sl-note { color: #6f6a61; font-size: 13px; }
.sl-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.sl-table th { text-align: left; font-weight: 600; padding: 8px 0; border-bottom: 1px solid #e6e1d8; }
.sl-table td { padding: 10px 0; border-bottom: 1px solid #f0ece4; }
.sl-total { display: flex; justify-content: space-between; padding-top: 14px; font-weight: 600; }
.sl-empty { color: #6f6a61; padding: 28px 0; }
.sl-qty { width: 58px; padding: 6px 8px; border: 1px solid #d9d3c8; border-radius: 6px; }
.sl-panel { border: 1px solid #e6e1d8; border-radius: 10px; background: #fff; padding: 20px; max-width: 420px; }
.sl-toggle { display: flex; align-items: center; gap: 10px; padding: 10px 0; }
.sl-badge { display: inline-block; font-size: 12px; padding: 2px 8px; border-radius: 999px;
  border: 1px solid #d9d3c8; color: #6f6a61; }
`;
