const answerKeyInput = document.getElementById("answerKeyInput");
const studentInput = document.getElementById("studentInput");
const answerPreview = document.getElementById("answerPreview");
const studentPreview = document.getElementById("studentPreview");
const scanButton = document.getElementById("scanButton");
const installButton = document.getElementById("installButton");
const statusBox = document.getElementById("status");
const resultBox = document.getElementById("result");
const historyBox = document.getElementById("history");

let deferredPrompt = null;

function idxToLabel(idx) {
  if (idx === null || idx === undefined) return "-";
  return String.fromCharCode(65 + idx);
}

function showPreview(input, img) {
  const file = input.files?.[0];
  if (!file) {
    img.classList.add("hidden");
    img.removeAttribute("src");
    return;
  }
  img.src = URL.createObjectURL(file);
  img.classList.remove("hidden");
}

answerKeyInput.addEventListener("change", () => showPreview(answerKeyInput, answerPreview));
studentInput.addEventListener("change", () => showPreview(studentInput, studentPreview));

function toGray(imageData) {
  const { data, width, height } = imageData;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    gray[p] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0;
  }
  return { gray, width, height };
}

function otsuThreshold(gray) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i += 1) hist[gray[i]] += 1;

  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 127;

  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;

    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);

    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }

  return threshold;
}

function connectedComponents(binary, width, height) {
  const visited = new Uint8Array(width * height);
  const components = [];

  const stackX = new Int32Array(width * height);
  const stackY = new Int32Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (!binary[idx] || visited[idx]) continue;

      let top = 0;
      stackX[top] = x;
      stackY[top] = y;
      top += 1;
      visited[idx] = 1;

      let area = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;

      while (top > 0) {
        top -= 1;
        const cx = stackX[top];
        const cy = stackY[top];
        area += 1;

        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        const neighbors = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ];

        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (visited[nIdx] || !binary[nIdx]) continue;
          visited[nIdx] = 1;
          stackX[top] = nx;
          stackY[top] = ny;
          top += 1;
        }
      }

      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      components.push({
        minX,
        minY,
        maxX,
        maxY,
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
        area,
        w,
        h,
        extent: area / (w * h),
      });
    }
  }

  return components;
}

function median(nums) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function clusterRows(circles, tolerance) {
  const rows = [];
  for (const circle of circles.sort((a, b) => a.cy - b.cy)) {
    const row = rows.find((r) => Math.abs(r.cy - circle.cy) <= tolerance);
    if (row) {
      row.items.push(circle);
      row.cy = row.items.reduce((acc, item) => acc + item.cy, 0) / row.items.length;
    } else {
      rows.push({ cy: circle.cy, items: [circle] });
    }
  }
  return rows;
}

function buildBinary(gray, threshold) {
  const binary = new Uint8Array(gray.length);
  const darkCutoff = Math.max(10, Math.min(245, Math.floor(threshold * 0.95)));
  for (let i = 0; i < gray.length; i += 1) binary[i] = gray[i] < darkCutoff ? 1 : 0;
  return binary;
}

function scoreFill(binary, width, comp) {
  let count = 0;
  for (let y = comp.minY; y <= comp.maxY; y += 1) {
    const rowStart = y * width;
    for (let x = comp.minX; x <= comp.maxX; x += 1) {
      if (binary[rowStart + x]) count += 1;
    }
  }
  const total = comp.w * comp.h;
  return total ? count / total : 0;
}

function parseSheetFromImageData(imageData) {
  const { gray, width, height } = toGray(imageData);
  const threshold = otsuThreshold(gray);
  const binary = buildBinary(gray, threshold);
  const components = connectedComponents(binary, width, height);

  const rough = components.filter((c) => c.area > 24 && c.w > 6 && c.h > 6 && c.extent > 0.08 && c.extent < 0.9);
  const areaMed = median(rough.map((c) => c.area));
  const sizeFiltered = rough.filter((c) => c.area >= areaMed * 0.3 && c.area <= areaMed * 3.8);
  const circles = sizeFiltered.filter((c) => {
    const ratio = c.w / c.h;
    return ratio > 0.5 && ratio < 1.8;
  });

  if (circles.length < 4) {
    return { questions: [], warnings: ["Too few bubble candidates detected. Use clearer image with good lighting."] };
  }

  const rowTol = Math.max(6, median(circles.map((c) => c.h)) * 0.8);
  const rows = clusterRows(circles, rowTol)
    .map((row) => ({
      ...row,
      items: row.items.sort((a, b) => a.cx - b.cx),
    }))
    .filter((row) => row.items.length >= 2)
    .sort((a, b) => a.cy - b.cy);

  const optionsPerRow = Math.max(2, Math.round(median(rows.map((r) => r.items.length))));

  const questions = rows.map((row, i) => {
    const choices = row.items.slice(0, optionsPerRow);
    const fills = choices.map((c) => scoreFill(binary, width, c));
    const ranked = fills
      .map((fill, idx) => ({ fill, idx }))
      .sort((a, b) => b.fill - a.fill);

    const top = ranked[0] || { fill: 0, idx: null };
    const second = ranked[1] || { fill: 0, idx: null };
    const confidence = Math.max(0, top.fill - second.fill);
    const blank = top.fill < 0.17;

    return {
      question: i + 1,
      option_count: choices.length,
      selected_index: blank ? null : top.idx,
      confidence: Number(confidence.toFixed(3)),
      fill_score: Number(top.fill.toFixed(3)),
    };
  });

  const warnings = [];
  if (rows.length === 0) warnings.push("No question rows detected.");
  if (optionsPerRow < 3) warnings.push("Low option count detected; verify sheet alignment.");

  return { questions, warnings };
}

async function fileToImageData(file) {
  const bitmap = await createImageBitmap(file);
  const maxSize = 1400;
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

function scoreSheets(key, student) {
  const questionCount = Math.min(key.questions.length, student.questions.length);
  const results = [];
  let correct = 0;
  let wrong = 0;
  let blank = 0;
  let reviewNeeded = 0;

  for (let i = 0; i < questionCount; i += 1) {
    const keyQ = key.questions[i];
    const stuQ = student.questions[i];

    let verdict = "wrong";
    if (stuQ.selected_index === null) {
      verdict = "blank";
      blank += 1;
    } else if (stuQ.confidence < 0.08 || keyQ.selected_index === null) {
      verdict = "review_needed";
      reviewNeeded += 1;
    } else if (stuQ.selected_index === keyQ.selected_index) {
      verdict = "correct";
      correct += 1;
    } else {
      verdict = "wrong";
      wrong += 1;
    }

    if (verdict === "wrong" && stuQ.confidence < 0.08) {
      verdict = "review_needed";
      reviewNeeded += 1;
      wrong -= 1;
    }

    results.push({
      question: i + 1,
      key_option_index: keyQ.selected_index,
      student_option_index: stuQ.selected_index,
      student_confidence: stuQ.confidence,
      verdict,
    });
  }

  const warnings = [...key.warnings, ...student.warnings];
  if (key.questions.length !== student.questions.length) {
    warnings.push(
      `Question count mismatch: key=${key.questions.length}, student=${student.questions.length}. Scored first ${questionCount}.`
    );
  }

  return {
    message: "Scoring completed (offline)",
    summary: {
      total: questionCount,
      correct,
      wrong,
      blank,
      review_needed: reviewNeeded,
    },
    results,
    warnings,
  };
}

function renderResult(data) {
  resultBox.innerHTML = "";

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

  const tableWrap = document.createElement("div");
  tableWrap.className = "tableWrap";

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

  tableWrap.appendChild(table);
  resultBox.append(summary, tableWrap);

  if (data.warnings?.length) {
    data.warnings.forEach((warning) => {
      const p = document.createElement("p");
      p.className = "warn";
      p.textContent = `⚠ ${warning}`;
      resultBox.appendChild(p);
    });
  }
}

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem("omrHistory") || "[]");
  } catch {
    return [];
  }
}

function saveHistory(result) {
  const history = getHistory();
  history.unshift({
    ts: new Date().toISOString(),
    summary: result.summary,
  });
  localStorage.setItem("omrHistory", JSON.stringify(history.slice(0, 10)));
}

function renderHistory() {
  const history = getHistory();
  historyBox.innerHTML = "";
  if (!history.length) {
    const li = document.createElement("li");
    li.textContent = "No scans yet.";
    historyBox.appendChild(li);
    return;
  }

  history.forEach((item) => {
    const li = document.createElement("li");
    const date = new Date(item.ts).toLocaleString();
    li.textContent = `${date} — Total ${item.summary.total}, Correct ${item.summary.correct}, Wrong ${item.summary.wrong}, Blank ${item.summary.blank}, Review ${item.summary.review_needed}`;
    historyBox.appendChild(li);
  });
}

scanButton.addEventListener("click", async () => {
  const answerKeyFile = answerKeyInput.files?.[0];
  const studentFile = studentInput.files?.[0];

  if (!answerKeyFile || !studentFile) {
    statusBox.textContent = "Please select both answer key and student sheet images.";
    return;
  }

  try {
    scanButton.disabled = true;
    statusBox.textContent = "Scanning offline...";
    resultBox.innerHTML = "";

    const [keyImageData, studentImageData] = await Promise.all([
      fileToImageData(answerKeyFile),
      fileToImageData(studentFile),
    ]);

    const keyParsed = parseSheetFromImageData(keyImageData);
    const studentParsed = parseSheetFromImageData(studentImageData);

    if (!keyParsed.questions.length || !studentParsed.questions.length) {
      throw new Error("Could not detect enough bubbles. Try clearer photos and keep sheet straight.");
    }

    const result = scoreSheets(keyParsed, studentParsed);
    renderResult(result);
    saveHistory(result);
    renderHistory();
    statusBox.textContent = result.message;
  } catch (error) {
    statusBox.textContent = error.message || "Scan failed.";
  } finally {
    scanButton.disabled = false;
  }
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  installButton.classList.remove("hidden");
});

installButton.addEventListener("click", async () => {
  if (!deferredPrompt) {
    statusBox.textContent = "If install is not shown, use browser menu → Add to Home Screen.";
    return;
  }
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installButton.classList.add("hidden");
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {
    statusBox.textContent = "Offline caching setup failed.";
  });
}

renderHistory();
