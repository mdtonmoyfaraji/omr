const answerKeyInput = document.getElementById("answerKeyInput");
const studentInput = document.getElementById("studentInput");
const questionStartInput = document.getElementById("questionStartInput");
const rangeStartInput = document.getElementById("rangeStartInput");
const rangeEndInput = document.getElementById("rangeEndInput");
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function showPreview(input, img) {
  const file = input.files?.[0];
  if (!file) {
    img.classList.add("hidden");
    img.removeAttribute("src");
    return;
  }

  const bitmap = await createImageBitmap(file);
  const maxWidth = 900;
  const scale = Math.min(1, maxWidth / bitmap.width);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  img.src = canvas.toDataURL("image/png");
  img.classList.remove("hidden");
}

answerKeyInput.addEventListener("change", () => showPreview(answerKeyInput, answerPreview).catch(() => {}));
studentInput.addEventListener("change", () => showPreview(studentInput, studentPreview).catch(() => {}));

function toGray(imageData) {
  const { data, width, height } = imageData;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    gray[p] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0;
  }
  return { gray, width, height };
}

function buildAdaptiveBinary(gray, width, height) {
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    for (let x = 1; x <= width; x += 1) {
      rowSum += gray[(y - 1) * width + (x - 1)];
      integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x] + rowSum;
    }
  }

  const binary = new Uint8Array(width * height);
  const half = Math.max(4, Math.floor(Math.min(width, height) / 26));
  const thresholdScale = 0.86;

  for (let y = 0; y < height; y += 1) {
    const y1 = Math.max(0, y - half);
    const y2 = Math.min(height - 1, y + half);
    const iy1 = y1;
    const iy2 = y2 + 1;
    for (let x = 0; x < width; x += 1) {
      const x1 = Math.max(0, x - half);
      const x2 = Math.min(width - 1, x + half);
      const ix1 = x1;
      const ix2 = x2 + 1;

      const area = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum =
        integral[iy2 * (width + 1) + ix2] -
        integral[iy1 * (width + 1) + ix2] -
        integral[iy2 * (width + 1) + ix1] +
        integral[iy1 * (width + 1) + ix1];
      const avg = sum / area;
      const idx = y * width + x;
      binary[idx] = gray[idx] < avg * thresholdScale ? 1 : 0;
    }
  }

  return binary;
}

function connectedComponents(binary, width, height) {
  const visited = new Uint8Array(width * height);
  const components = [];
  const stack = new Int32Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const startIdx = y * width + x;
      if (!binary[startIdx] || visited[startIdx]) continue;

      let top = 0;
      stack[top] = startIdx;
      top += 1;
      visited[startIdx] = 1;

      let area = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let touchesEdge = false;

      while (top > 0) {
        top -= 1;
        const idx = stack[top];
        const cx = idx % width;
        const cy = (idx / width) | 0;
        area += 1;

        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        if (cx === 0 || cy === 0 || cx === width - 1 || cy === height - 1) touchesEdge = true;

        if (cx > 0) {
          const left = idx - 1;
          if (!visited[left] && binary[left]) {
            visited[left] = 1;
            stack[top] = left;
            top += 1;
          }
        }
        if (cx + 1 < width) {
          const right = idx + 1;
          if (!visited[right] && binary[right]) {
            visited[right] = 1;
            stack[top] = right;
            top += 1;
          }
        }
        if (cy > 0) {
          const up = idx - width;
          if (!visited[up] && binary[up]) {
            visited[up] = 1;
            stack[top] = up;
            top += 1;
          }
        }
        if (cy + 1 < height) {
          const down = idx + width;
          if (!visited[down] && binary[down]) {
            visited[down] = 1;
            stack[top] = down;
            top += 1;
          }
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
        extent: area / Math.max(1, w * h),
        radius: (w + h) / 4,
        touchesEdge,
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

function groupRowsSequential(circles, tolerance) {
  if (!circles.length) return [];
  const sorted = [...circles].sort((a, b) => a.cy - b.cy);
  const rows = [];
  let row = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const curr = sorted[i];
    const avgY = row.reduce((acc, item) => acc + item.cy, 0) / row.length;
    if (Math.abs(curr.cy - avgY) <= tolerance) {
      row.push(curr);
    } else {
      rows.push(row.sort((a, b) => a.cx - b.cx));
      row = [curr];
    }
  }
  rows.push(row.sort((a, b) => a.cx - b.cx));
  return rows;
}

function detectBubbleCandidates(imageData) {
  const { gray, width, height } = toGray(imageData);
  const binary = buildAdaptiveBinary(gray, width, height);
  const components = connectedComponents(binary, width, height);
  const imageArea = width * height;

  const rough = components.filter((c) => {
    if (c.touchesEdge) return false;
    if (c.area < Math.max(20, imageArea * 0.000012)) return false;
    if (c.area > imageArea * 0.0045) return false;
    const ratio = c.w / Math.max(1, c.h);
    return ratio > 0.62 && ratio < 1.45 && c.extent > 0.12 && c.extent < 0.82;
  });

  if (!rough.length) {
    return { width, height, binary, circles: [] };
  }

  const areaMed = median(rough.map((c) => c.area));
  const radiusMed = median(rough.map((c) => c.radius));
  const circles = rough.filter((c) => {
    const areaOk = c.area >= areaMed * 0.35 && c.area <= areaMed * 2.8;
    const radiusOk = c.radius >= radiusMed * 0.55 && c.radius <= radiusMed * 1.95;
    return areaOk && radiusOk;
  });

  return { width, height, binary, circles };
}

function estimateOmrBounds(circles, width, height) {
  if (circles.length < 25) return null;
  const minX = Math.min(...circles.map((c) => c.minX));
  const maxX = Math.max(...circles.map((c) => c.maxX));
  const minY = Math.min(...circles.map((c) => c.minY));
  const maxY = Math.max(...circles.map((c) => c.maxY));
  const pad = Math.max(12, Math.round(median(circles.map((c) => c.radius)) * 2.4));

  const left = clamp(minX - pad, 0, width - 1);
  const top = clamp(minY - pad, 0, height - 1);
  const right = clamp(maxX + pad, left + 1, width);
  const bottom = clamp(maxY + pad, top + 1, height);

  return {
    x: left,
    y: top,
    w: right - left,
    h: bottom - top,
  };
}

function cropImageData(imageData, rect) {
  const src = imageData.data;
  const dst = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y += 1) {
    const srcStart = ((rect.y + y) * imageData.width + rect.x) * 4;
    const srcEnd = srcStart + rect.w * 4;
    dst.set(src.subarray(srcStart, srcEnd), y * rect.w * 4);
  }
  return new ImageData(dst, rect.w, rect.h);
}

function splitColumnBlocks(circles) {
  const ordered = [...circles].sort((a, b) => a.cx - b.cx);
  if (ordered.length < 2) return [ordered];

  const gaps = [];
  for (let i = 1; i < ordered.length; i += 1) gaps.push(ordered[i].cx - ordered[i - 1].cx);
  const medianGap = median(gaps);
  const medianRadius = median(ordered.map((c) => c.radius));
  const splitGap = Math.max(medianGap * 2.2, medianRadius * 5.2);

  const blocks = [];
  let current = [ordered[0]];
  for (let i = 1; i < ordered.length; i += 1) {
    const gap = ordered[i].cx - ordered[i - 1].cx;
    if (gap > splitGap) {
      blocks.push(current);
      current = [ordered[i]];
    } else {
      current.push(ordered[i]);
    }
  }
  blocks.push(current);
  return blocks;
}

function pickBestOptionWindow(items, targetCount) {
  if (items.length <= targetCount) return items;
  let best = items.slice(0, targetCount);
  let bestSpan = Number.POSITIVE_INFINITY;
  for (let start = 0; start <= items.length - targetCount; start += 1) {
    const window = items.slice(start, start + targetCount);
    const span = window[window.length - 1].cx - window[0].cx;
    if (span < bestSpan) {
      best = window;
      bestSpan = span;
    }
  }
  return best;
}

function scoreBubbleFill(binary, width, bubble) {
  const centerX = Math.round(bubble.cx);
  const centerY = Math.round(bubble.cy);
  const coreRadius = Math.max(2, Math.round(bubble.radius * 0.6));
  const r2 = coreRadius * coreRadius;
  let total = 0;
  let dark = 0;

  for (let y = centerY - coreRadius; y <= centerY + coreRadius; y += 1) {
    if (y < 0) continue;
    const rowOffset = y * width;
    for (let x = centerX - coreRadius; x <= centerX + coreRadius; x += 1) {
      if (x < 0 || x >= width) continue;
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy > r2) continue;
      total += 1;
      if (binary[rowOffset + x]) dark += 1;
    }
  }

  return total ? dark / total : 0;
}

function buildQuestionsFromCircles(circles, binary, width, warnings) {
  if (circles.length < 8) {
    return {
      questions: [],
      warnings: [...warnings, "Too few bubble candidates detected. Use a clearer, front-facing sheet image."],
    };
  }

  const blocks = splitColumnBlocks(circles)
    .map((block) => block.sort((a, b) => a.cy - b.cy))
    .filter((block) => block.length >= 8)
    .sort((a, b) => median(a.map((c) => c.cx)) - median(b.map((c) => c.cx)));

  const questions = [];
  let qNo = 1;

  blocks.forEach((block, blockIndex) => {
    const rowTolerance = Math.max(5, Math.round(median(block.map((c) => c.radius)) * 1.9));
    const groupedRows = groupRowsSequential(block, rowTolerance).filter((row) => row.length >= 2);
    if (!groupedRows.length) return;

    const optionsPerRow = clamp(Math.round(median(groupedRows.map((row) => row.length))), 2, 8);
    groupedRows.forEach((row) => {
      const sorted = [...row].sort((a, b) => a.cx - b.cx);
      const choices = pickBestOptionWindow(sorted, optionsPerRow);
      const fills = choices.map((bubble) => scoreBubbleFill(binary, width, bubble));
      const ranked = fills
        .map((fill, idx) => ({ fill, idx }))
        .sort((a, b) => b.fill - a.fill);

      const top = ranked[0] || { fill: 0, idx: null };
      const second = ranked[1] || { fill: 0, idx: null };
      const baseline = median(fills);
      const markThreshold = Math.max(0.18, baseline + 0.12);
      const multipleThreshold = Math.max(0.2, markThreshold * 0.92);
      const confidence = Math.max(0, top.fill - second.fill);

      let status = "marked";
      let selected = top.idx;
      if (top.fill < markThreshold) {
        status = "blank";
        selected = null;
      } else if (second.fill >= multipleThreshold && confidence < 0.085) {
        status = "multiple";
        selected = null;
      } else if (confidence < 0.045) {
        status = "review_needed";
      }

      questions.push({
        question: qNo,
        block: blockIndex + 1,
        option_count: choices.length,
        selected_index: selected,
        status,
        confidence: Number(confidence.toFixed(3)),
        fill_score: Number(top.fill.toFixed(3)),
      });
      qNo += 1;
    });
  });

  if (!questions.length) warnings.push("No question rows detected after filtering.");
  return { questions, warnings };
}

function parseSheetFromImageData(imageData) {
  const initial = detectBubbleCandidates(imageData);
  const warnings = [];
  let analysis = initial;

  if (initial.circles.length >= 25) {
    const crop = estimateOmrBounds(initial.circles, initial.width, initial.height);
    if (crop) {
      const cropArea = crop.w * crop.h;
      const fullArea = initial.width * initial.height;
      if (cropArea < fullArea * 0.96) {
        analysis = detectBubbleCandidates(cropImageData(imageData, crop));
        warnings.push("Auto-cropped surrounding area to focus on the answer region.");
      }
    }
  }

  if (analysis.circles.length < 8 && initial !== analysis) {
    analysis = initial;
    warnings.push("Cropped parsing was weak; retried with full image.");
  }

  return buildQuestionsFromCircles(analysis.circles, analysis.binary, analysis.width, warnings);
}

async function fileToImageData(file) {
  const bitmap = await createImageBitmap(file);
  const maxDim = Math.max(bitmap.width, bitmap.height);
  const targetDim = 2200;
  const scale = clamp(targetDim / maxDim, 0.8, 2);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

function parseScanSettings() {
  const startValue = Number.parseInt(questionStartInput.value, 10);
  const rangeStartValue = Number.parseInt(rangeStartInput.value, 10);
  const rangeEndValue = Number.parseInt(rangeEndInput.value, 10);
  const warnings = [];

  const questionStart = Number.isFinite(startValue) && startValue > 0 ? startValue : 1;
  let rangeStart = Number.isFinite(rangeStartValue) && rangeStartValue > 0 ? rangeStartValue : null;
  let rangeEnd = Number.isFinite(rangeEndValue) && rangeEndValue > 0 ? rangeEndValue : null;

  if ((rangeStart !== null && rangeEnd === null) || (rangeStart === null && rangeEnd !== null)) {
    const fixed = rangeStart ?? rangeEnd;
    rangeStart = fixed;
    rangeEnd = fixed;
    warnings.push("Single range value provided; scoring only that question.");
  }

  if (rangeStart !== null && rangeEnd !== null && rangeStart > rangeEnd) {
    const tmp = rangeStart;
    rangeStart = rangeEnd;
    rangeEnd = tmp;
    warnings.push("Swapped range because start was greater than end.");
  }

  return {
    questionStart,
    rangeStart,
    rangeEnd,
    warnings,
  };
}

function inSelectedRange(questionNumber, settings) {
  if (settings.rangeStart === null || settings.rangeEnd === null) return true;
  return questionNumber >= settings.rangeStart && questionNumber <= settings.rangeEnd;
}

function scoreSheets(key, student, settings) {
  const questionCount = Math.min(key.questions.length, student.questions.length);
  const results = [];
  let correct = 0;
  let wrong = 0;
  let blank = 0;
  let multiple = 0;
  let reviewNeeded = 0;

  for (let i = 0; i < questionCount; i += 1) {
    const keyQ = key.questions[i];
    const stuQ = student.questions[i];
    const questionNumber = settings.questionStart + i;
    if (!inSelectedRange(questionNumber, settings)) continue;

    let verdict = "wrong";
    if (keyQ.status !== "marked" || keyQ.selected_index === null) {
      verdict = "key_invalid";
      reviewNeeded += 1;
    } else if (stuQ.status === "blank" || stuQ.selected_index === null) {
      verdict = stuQ.status === "multiple" ? "multiple" : "blank";
      if (verdict === "multiple") multiple += 1;
      else blank += 1;
    } else if (stuQ.status === "review_needed" || stuQ.confidence < 0.045) {
      verdict = "review_needed";
      reviewNeeded += 1;
    } else if (stuQ.selected_index === keyQ.selected_index) {
      verdict = "correct";
      correct += 1;
    } else {
      verdict = "wrong";
      wrong += 1;
    }

    results.push({
      question: questionNumber,
      key_option_index: keyQ.selected_index,
      student_option_index: stuQ.selected_index,
      student_status: stuQ.status,
      student_confidence: stuQ.confidence,
      verdict,
    });
  }

  const warnings = [...key.warnings, ...student.warnings, ...settings.warnings];
  if (key.questions.length !== student.questions.length) {
    warnings.push(
      `Question count mismatch: key=${key.questions.length}, student=${student.questions.length}.`
    );
  }
  if (!results.length) {
    warnings.push("No questions matched your selected scoring range.");
  }

  return {
    message: "Scoring completed (offline, accuracy mode)",
    summary: {
      total: results.length,
      correct,
      wrong,
      blank,
      multiple,
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
  const summaryItems = [
    ["Total", s.total],
    ["Correct", s.correct],
    ["Wrong", s.wrong],
    ["Blank", s.blank],
    ["Multiple", s.multiple],
    ["Review", s.review_needed],
  ];
  summaryItems.forEach(([label, value]) => {
    const badge = document.createElement("div");
    badge.className = "badge";
    const strong = document.createElement("b");
    strong.textContent = String(value);
    badge.append(`${label}: `, strong);
    summary.appendChild(badge);
  });

  const tableWrap = document.createElement("div");
  tableWrap.className = "tableWrap";

  const table = document.createElement("table");
  table.className = "table";
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["Q", "Key", "Student", "Detected", "Verdict", "Confidence"].forEach((text) => {
    const th = document.createElement("th");
    th.textContent = text;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  const tbody = document.createElement("tbody");
  data.results.forEach((r) => {
    const tr = document.createElement("tr");
    const values = [
      r.question,
      idxToLabel(r.key_option_index),
      idxToLabel(r.student_option_index),
      r.student_status,
      r.verdict,
      r.student_confidence,
    ];
    values.forEach((value) => {
      const td = document.createElement("td");
      td.textContent = String(value);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.append(thead, tbody);
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
    li.textContent = `${date} — Total ${item.summary.total}, Correct ${item.summary.correct}, Wrong ${item.summary.wrong}, Blank ${item.summary.blank}, Multiple ${item.summary.multiple || 0}, Review ${item.summary.review_needed}`;
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

  const settings = parseScanSettings();

  try {
    scanButton.disabled = true;
    statusBox.textContent = "Scanning in accuracy mode...";
    resultBox.innerHTML = "";

    const [keyImageData, studentImageData] = await Promise.all([
      fileToImageData(answerKeyFile),
      fileToImageData(studentFile),
    ]);

    const keyParsed = parseSheetFromImageData(keyImageData);
    const studentParsed = parseSheetFromImageData(studentImageData);

    if (!keyParsed.questions.length || !studentParsed.questions.length) {
      throw new Error("Could not detect enough bubbles. Try a clearer photo and keep the sheet fully visible.");
    }

    const result = scoreSheets(keyParsed, studentParsed, settings);
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
