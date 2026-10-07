import { fmt } from "./api.js";

function Block({ b }) {
  if (b.type === "heading") return <h3>{b.text}</h3>;
  if (b.type === "note") return <p className={`note ${b.ok === false ? "bad" : b.ok ? "good" : ""}`}>{b.text}</p>;
  if (b.type === "lines")
    return (
      <div className="stmt">
        {b.rows.map((r, i) => (
          <div key={i} className={`ln ${r.heading ? "head" : ""} ${r.bold ? "bold" : ""} ${r.rule ? "rule" : ""}`} style={{ paddingLeft: (r.indent || 0) * 20 }}>
            <span>{r.label}</span>
            <span className="num">{r.amount != null ? fmt(r.amount) : ""}</span>
          </div>
        ))}
      </div>
    );
  const cell = (c, row) => (c.money ? <td key={c.key} className="num">{fmt(row[c.key])}</td> : <td key={c.key}>{row[c.key]}</td>);
  return (
    <div className="scroll">
      <table>
        <thead><tr>{b.columns.map((c) => <th key={c.key} className={c.money ? "num" : ""}>{c.label}</th>)}</tr></thead>
        <tbody>
          {b.rows.map((r, i) => <tr key={i} className={r.bold ? "bold" : ""}>{b.columns.map((c) => cell(c, r))}</tr>)}
        </tbody>
        {b.footer && <tfoot><tr>{b.columns.map((c) => cell(c, b.footer))}</tr></tfoot>}
      </table>
    </div>
  );
}

export default function ReportView({ doc }) {
  return (
    <article className="sheet">
      <p className="co">{doc.company}</p>
      <h1>{doc.title}</h1>
      <p className="sub">{doc.subtitle}</p>
      {doc.blocks.map((b, i) => <Block key={i} b={b} />)}
    </article>
  );
}
