// Every report is returned as { company, title, subtitle, blocks }.
// The same document drives the on-screen view (React) and the PDF export.
import JournalEntry from "../models/JournalEntry.js";
import Account from "../models/Account.js";
import * as FS from "./financialStatements.js";
import { money } from "./pdf.js";

const ST = ["posted", "reversed"];
const ALL = ["standard", "adjusting"];
const day = (s, end) => new Date(`${s}T${end ? "23:59:59.999" : "00:00:00.000"}Z`);
const fmt = (d) => new Date(d).toISOString().slice(0, 10);
const nz = (n) => (n ? n : null);
const sum = (arr, k) => arr.reduce((s, r) => s + (r[k] || 0), 0);
const item = (r, indent = 1) => ({ label: `${r.code}  ${r.name}`, amount: r.amount, indent });
const sec = (title, list) => [{ label: title, heading: true }, ...list.map((r) => item(r))];
const total = (label, amount) => ({ label, amount, bold: true, rule: true });
const check = (ok, good, bad) => ({ type: "note", ok, text: ok ? good : bad });

async function trialBalance(to, types, title, subtitle) {
  const agg = await JournalEntry.aggregate([
    { $match: { status: { $in: ST }, type: { $in: types }, date: { $lte: to } } },
    { $unwind: "$lines" },
    { $group: { _id: "$lines.account", d: { $sum: "$lines.debit" }, c: { $sum: "$lines.credit" } } },
  ]);
  const accs = await Account.find({ _id: { $in: agg.map((r) => r._id) } }).lean();
  const byId = new Map(accs.map((a) => [String(a._id), a]));
  const rows = agg
    .map((r) => {
      const a = byId.get(String(r._id));
      const n = r.d - r.c;
      return { code: a.code, name: a.name, debit: n > 0 ? n : null, credit: n < 0 ? -n : null };
    })
    .filter((r) => r.debit || r.credit)
    .sort((a, b) => a.code.localeCompare(b.code));
  const D = sum(rows, "debit"), C = sum(rows, "credit");
  return {
    title, subtitle,
    blocks: [
      {
        type: "table",
        columns: [{ key: "code", label: "Code" }, { key: "name", label: "Account", w: 3 }, { key: "debit", label: "Debit", money: true, w: 1.5 }, { key: "credit", label: "Credit", money: true, w: 1.5 }],
        rows,
        footer: { name: "Totals", debit: D, credit: C },
      },
      check(D === C, "Total debits equal total credits.", `Out of balance by ${money(Math.abs(D - C))}. Check recent entries.`),
    ],
  };
}

const builders = {
  async journal({ from, to, q, range }) {
    const match = { status: { $in: ST }, date: { $gte: from, $lte: to } };
    if (q.type) match.type = q.type;
    const entries = await JournalEntry.find(match).sort({ date: 1, reference: 1 }).populate("lines.account", "code name").lean();
    const rows = [];
    for (const e of entries)
      e.lines.forEach((l, i) =>
        rows.push({
          date: i ? "" : fmt(e.date),
          ref: i ? "" : e.reference,
          account: l.account ? `${l.account.code} ${l.account.name}` : "(deleted account)",
          description: i ? l.memo || "" : e.description + (e.status === "reversed" ? " (reversed)" : ""),
          debit: nz(l.debit), credit: nz(l.credit),
        })
      );
    return {
      title: q.type === "adjusting" ? "Adjusting Entries" : "General Journal",
      subtitle: range,
      blocks: [{
        type: "table",
        columns: [{ key: "date", label: "Date" }, { key: "ref", label: "Ref" }, { key: "account", label: "Account", w: 2.5 }, { key: "description", label: "Description", w: 2.5 }, { key: "debit", label: "Debit", money: true, w: 1.3 }, { key: "credit", label: "Credit", money: true, w: 1.3 }],
        rows,
        footer: { account: "Totals", debit: sum(rows, "debit"), credit: sum(rows, "credit") },
      }],
    };
  },

  async ledger({ from, to, q, range }) {
    const accs = q.account ? await Account.find({ _id: q.account }).lean() : await Account.find().sort({ code: 1 }).lean();
    const blocks = [];
    for (const a of accs) {
      const entries = await JournalEntry.find({ status: { $in: ST }, type: { $in: ALL }, "lines.account": a._id, date: { $lte: to } })
        .sort({ date: 1, createdAt: 1 }).lean();
      let bal = 0, opening = 0, D = 0, C = 0;
      const rows = [];
      for (const e of entries)
        for (const l of e.lines) {
          if (String(l.account) !== String(a._id)) continue;
          bal += a.normalBalance === "debit" ? l.debit - l.credit : l.credit - l.debit;
          if (e.date < from) opening = bal;
          else {
            D += l.debit; C += l.credit;
            rows.push({ date: fmt(e.date), ref: e.reference, description: e.description, debit: nz(l.debit), credit: nz(l.credit), balance: bal });
          }
        }
      if (!rows.length && !opening && !q.account) continue;
      blocks.push({ type: "heading", text: `${a.code}  ${a.name}` });
      blocks.push({
        type: "table",
        columns: [{ key: "date", label: "Date" }, { key: "ref", label: "Ref" }, { key: "description", label: "Description", w: 3 }, { key: "debit", label: "Debit", money: true, w: 1.3 }, { key: "credit", label: "Credit", money: true, w: 1.3 }, { key: "balance", label: "Balance", money: true, w: 1.4 }],
        rows: [{ description: "Opening balance", balance: opening, bold: true }, ...rows],
        footer: { description: "Closing balance", debit: D, credit: C, balance: bal },
      });
    }
    if (!blocks.length) blocks.push({ type: "note", text: "No activity in this period." });
    return { title: "General Ledger", subtitle: range, blocks };
  },

  "trial-balance": ({ to, asof }) => trialBalance(to, ["standard"], "Trial Balance", `${asof} (before adjusting entries)`),
  "adjusted-trial-balance": ({ to, asof }) => trialBalance(to, ALL, "Adjusted Trial Balance", `${asof} (after adjusting entries)`),

  async "income-statement"({ from, to, range }) {
    const s = await FS.incomeStatement({ from, to });
    return {
      title: "Income Statement", subtitle: range,
      blocks: [{
        type: "lines",
        rows: [
          ...sec("Revenue", [...s.operatingRevenue, ...s.otherRevenue]), total("Total revenue", s.totalRevenue),
          ...sec("Expenses", [...s.operatingExpenses, ...s.depreciation, ...s.otherExpenses]), total("Total expenses", s.totalExpenses),
          { label: "", heading: true }, total("Net income (loss)", s.netIncome),
        ],
      }],
    };
  },

  async "equity-statement"({ from, to, range }) {
    const e = await FS.equityStatement({ from, to });
    return {
      title: "Statement of Owner's Equity", subtitle: range,
      blocks: [
        { type: "lines", rows: [
          { label: "Owner's equity, beginning", amount: e.openingEquity, bold: true },
          { label: "Add: owner contributions", amount: e.contributions, indent: 1 },
          { label: "Add: net income (loss)", amount: e.netIncome, indent: 1 },
          { label: "Less: owner drawings", amount: e.drawings, indent: 1 },
          total("Owner's equity, ending", e.closingEquity),
        ] },
        check(e.balanced, "Ending equity agrees with the balance sheet.", "Ending equity does not agree with the balance sheet. Check account tags."),
      ],
    };
  },

  async "balance-sheet"({ to, asof }) {
    const b = await FS.balanceSheet({ asOf: to });
    return {
      title: "Balance Sheet", subtitle: asof,
      blocks: [
        { type: "lines", rows: [
          { label: "Assets", heading: true },
          ...sec("Current assets", b.assets.currentAssets).slice(0),
          ...sec("Fixed assets", [...b.assets.fixedAssets, ...b.assets.contraAssets]),
          total("Total assets", b.assets.total),
          { label: "Liabilities", heading: true },
          ...sec("Current liabilities", b.liabilities.currentLiabilities),
          ...sec("Long-term liabilities", b.liabilities.longTermLiabilities),
          total("Total liabilities", b.liabilities.total),
          { label: "Owner's equity", heading: true },
          { label: "Owner's capital", amount: b.equity.capital, indent: 1 },
          { label: "Retained earnings (includes current income)", amount: b.equity.retainedEarnings, indent: 1 },
          { label: "Less: owner drawings", amount: b.equity.drawings, indent: 1 },
          total("Total owner's equity", b.equity.total),
          total("Total liabilities and equity", b.totalLiabilitiesAndEquity),
        ] },
        check(b.balanced, "Assets equal liabilities plus equity.", "Balance sheet doesn't balance. Check account tags (subType) in the chart of accounts."),
      ],
    };
  },

  async "cash-flow"({ from, to, range }) {
    const c = await FS.cashFlowStatement({ from, to });
    return {
      title: "Cash Flow Statement", subtitle: `${range} (indirect method)`,
      blocks: [
        { type: "lines", rows: [
          { label: "Operating activities", heading: true },
          { label: "Net income (loss)", amount: c.operating.netIncome, indent: 1 },
          ...c.operating.adjustments.map((r) => item(r)),
          total("Net cash from operating activities", c.operating.total),
          { label: "Investing activities", heading: true },
          ...c.investing.items.map((r) => item(r)),
          total("Net cash from investing activities", c.investing.total),
          { label: "Financing activities", heading: true },
          ...c.financing.items.map((r) => item(r)),
          total("Net cash from financing activities", c.financing.total),
          { label: "", heading: true },
          total("Net change in cash", c.netChangeInCash),
          { label: "Cash, beginning", amount: c.openingCash, indent: 1 },
          total("Cash, ending", c.closingCash),
        ] },
        check(c.reconciled, "Ending cash agrees with the cash accounts.", "Cash flow doesn't reconcile to cash accounts. Check cashFlow tags."),
      ],
    };
  },
};

export async function buildReport(name, q) {
  const build = builders[name];
  if (!build) throw new Error("Unknown report");
  const to = day(q.to || fmt(new Date()), true);
  const from = day(q.from || `${to.getUTCFullYear()}-01-01`);
  const doc = await build({
    from, to, q,
    range: `For the period ${fmt(from)} to ${fmt(to)}`,
    asof: `As of ${fmt(to)}`,
  });
  return { company: process.env.COMPANY_NAME || "Car Rental Co.", ...doc };
}
