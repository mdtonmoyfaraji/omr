const form = document.getElementById("scanForm");
const statusBox = document.getElementById("status");
const resultBox = document.getElementById("result");

function idxToLabel(idx) {
  if (idx === null || idx === undefined) return "-";
  return String.fromCharCode(65 + idx);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  statusBox.textContent = "Scanning...";
  resultBox.innerHTML = "";

  const formData = new FormData(form);

  try {
    const res = await fetch("/api/score", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || "Failed to score sheets");
    }

    statusBox.textContent = data.message;

    const s = data.summary;
    const summary = document.createElement("div");
    summary.className = "grid";
    summary.innerHTML = `
      <div class="badge">Total: <b>${s.total}</b></div>
      <div class="badge">Correct: <b>${s.correct}</b></div>
      <div class="badge">Wrong: <b>${s.wrong}</b></div>
      <div class="badge">Blank: <b>${s.blank}</b></div>
      <div class="badge">Review: <b>${s.review_needed}</b></div>
    `;

    const table = document.createElement("table");
    table.className = "table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Q</th>
          <th>Key</th>
          <th>Student</th>
          <th>Verdict</th>
          <th>Confidence</th>
        </tr>
      </thead>
      <tbody>
        ${data.results
          .map(
            (r) => `
              <tr>
                <td>${r.question}</td>
                <td>${idxToLabel(r.key_option_index)}</td>
                <td>${idxToLabel(r.student_option_index)}</td>
                <td>${r.verdict}</td>
                <td>${r.student_confidence}</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    `;

    resultBox.append(summary, table);

    if (data.warnings?.length) {
      for (const warning of data.warnings) {
        const p = document.createElement("p");
        p.className = "warn";
        p.textContent = `⚠ ${warning}`;
        resultBox.appendChild(p);
      }
    }
  } catch (err) {
    statusBox.textContent = err.message;
  }
});
