/**
 * Stremux AutoClaim - Interactive Canvas Damage Annotator
 * Supports Circle/Ellipse, Rectangle, Freehand Pen, Arrow, Damage Tags, and Undo/Redo
 */

class DamageAnnotator {
  constructor() {
    this.modal = document.getElementById("annotatorModal");
    this.canvas = document.getElementById("annotationCanvas");
    this.ctx = this.canvas.getContext("2d");

    this.currentSide = null;
    this.baseImage = null;
    this.annotations = [];
    this.redoStack = [];

    this.activeTool = "circle"; // "circle", "rect", "pen", "arrow"
    this.activeTag = { id: "dent", label: "Dent", color: "#ff3b30" };
    this.strokeWidth = 3;

    this.isDrawing = false;
    this.startX = 0;
    this.startY = 0;
    this.currentPoints = [];

    this.onSaveCallback = null;

    this.customTags = this._loadCustomTags();
    this.selectedCustomColor = "#ec4899";

    this._initEventListeners();
    this._initCustomDefectListeners();
    this._renderCustomTags();
  }

  _loadCustomTags() {
    try {
      const stored = localStorage.getItem("autoclaim_custom_damage_tags");
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  }

  _saveCustomTags() {
    try {
      localStorage.setItem("autoclaim_custom_damage_tags", JSON.stringify(this.customTags));
    } catch (e) {}
  }

  _escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  _renderCustomTags() {
    const list = document.getElementById("tagSelectList");
    if (!list) return;

    // Remove existing custom pills
    list.querySelectorAll(".custom-pill").forEach(el => el.remove());

    // Append custom tags
    this.customTags.forEach(tag => {
      const pill = document.createElement("div");
      pill.className = "tag-pill custom-pill";
      if (this.activeTag && this.activeTag.id === tag.id) {
        pill.classList.add("active");
      }
      pill.dataset.tag = tag.id;
      pill.dataset.label = tag.label;
      pill.dataset.color = tag.color;
      pill.innerHTML = `
        <span class="tag-color-dot" style="background: ${tag.color};"></span>
        <span class="tag-title" title="${this._escapeHtml(tag.label)}">🏷️ ${this._escapeHtml(tag.label)}</span>
        <button type="button" class="btn-remove-tag" title="Remove defect" data-id="${tag.id}">✕</button>
      `;

      const removeBtn = pill.querySelector(".btn-remove-tag");
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._removeCustomTag(tag.id);
      });

      list.appendChild(pill);
    });
  }

  _selectTag(tag) {
    this.activeTag = {
      id: tag.id,
      label: tag.label,
      color: tag.color
    };

    document.querySelectorAll(".tag-pill").forEach(p => {
      if (p.dataset.tag === tag.id) {
        p.classList.add("active");
      } else {
        p.classList.remove("active");
      }
    });
  }

  _removeCustomTag(tagId) {
    this.customTags = this.customTags.filter(t => t.id !== tagId);
    this._saveCustomTags();

    // If currently active tag was deleted, fall back to default 'dent'
    if (this.activeTag && this.activeTag.id === tagId) {
      const dentPill = document.querySelector('.tag-pill[data-tag="dent"]');
      if (dentPill) {
        this._selectTag({
          id: dentPill.dataset.tag,
          label: dentPill.dataset.label,
          color: dentPill.dataset.color
        });
      }
    }

    this._renderCustomTags();
  }

  _initCustomDefectListeners() {
    const btnToggle = document.getElementById("btnToggleAddDefect");
    const form = document.getElementById("customDefectForm");
    const btnClose = document.getElementById("btnCloseDefectForm");
    const input = document.getElementById("customDefectInput");
    const btnAdd = document.getElementById("btnAddDefectConfirm");
    const palette = document.getElementById("customColorPalette");

    if (btnToggle && form) {
      btnToggle.addEventListener("click", () => {
        form.style.display = "flex";
        btnToggle.style.display = "none";
        if (input) {
          input.focus();
          input.select();
        }
      });
    }

    if (btnClose && form && btnToggle) {
      btnClose.addEventListener("click", () => {
        form.style.display = "none";
        btnToggle.style.display = "flex";
      });
    }

    // Color swatches
    if (palette) {
      palette.querySelectorAll(".color-swatch").forEach(swatch => {
        swatch.addEventListener("click", () => {
          palette.querySelectorAll(".color-swatch").forEach(s => s.classList.remove("active"));
          swatch.classList.add("active");
          this.selectedCustomColor = swatch.dataset.color;
        });
      });
    }

    // Quick chips
    document.querySelectorAll(".defect-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        if (input) {
          input.value = chip.dataset.name;
          this._submitNewDefect();
        }
      });
    });

    // Add button
    if (btnAdd) {
      btnAdd.addEventListener("click", () => this._submitNewDefect());
    }

    // Enter key inside input
    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this._submitNewDefect();
        } else if (e.key === "Escape") {
          if (btnClose) btnClose.click();
        }
      });
    }
  }

  _submitNewDefect() {
    const input = document.getElementById("customDefectInput");
    const form = document.getElementById("customDefectForm");
    const btnToggle = document.getElementById("btnToggleAddDefect");
    if (!input) return;

    const val = input.value.trim();
    if (!val) {
      input.focus();
      return;
    }

    // Check if already exists in default or custom tags
    const existingDefault = Array.from(document.querySelectorAll('.tag-pill:not(.custom-pill)')).find(
      p => p.dataset.label.toLowerCase() === val.toLowerCase()
    );
    if (existingDefault) {
      this._selectTag({
        id: existingDefault.dataset.tag,
        label: existingDefault.dataset.label,
        color: existingDefault.dataset.color
      });
      input.value = "";
      if (form) form.style.display = "none";
      if (btnToggle) btnToggle.style.display = "flex";
      return;
    }

    const existingCustom = this.customTags.find(t => t.label.toLowerCase() === val.toLowerCase());
    if (existingCustom) {
      this._selectTag(existingCustom);
      input.value = "";
      if (form) form.style.display = "none";
      if (btnToggle) btnToggle.style.display = "flex";
      return;
    }

    // Create new custom defect tag
    const newTag = {
      id: "custom_" + Date.now(),
      label: val,
      color: this.selectedCustomColor || "#ec4899"
    };

    this.customTags.push(newTag);
    this._saveCustomTags();
    this._renderCustomTags();
    this._selectTag(newTag);

    input.value = "";
    if (form) form.style.display = "none";
    if (btnToggle) btnToggle.style.display = "flex";
  }

  _initEventListeners() {
    // Tool buttons
    document.querySelectorAll(".tool-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        document.querySelectorAll(".tool-btn").forEach(b => b.classList.remove("active"));
        const target = e.currentTarget;
        target.classList.add("active");
        this.activeTool = target.dataset.tool;
      });
    });

    // Tag pills - delegated listener
    const tagList = document.getElementById("tagSelectList");
    if (tagList) {
      tagList.addEventListener("click", (e) => {
        if (e.target.closest(".btn-remove-tag")) return;
        const pill = e.target.closest(".tag-pill");
        if (!pill) return;
        this._selectTag({
          id: pill.dataset.tag,
          label: pill.dataset.label,
          color: pill.dataset.color
        });
      });
    }

    // Canvas mouse events
    this.canvas.addEventListener("mousedown", this._handleMouseDown.bind(this));
    this.canvas.addEventListener("mousemove", this._handleMouseMove.bind(this));
    this.canvas.addEventListener("mouseup", this._handleMouseUp.bind(this));
    this.canvas.addEventListener("mouseleave", this._handleMouseUp.bind(this));

    // Touch events for mobile/tablet
    this.canvas.addEventListener("touchstart", this._handleTouchStart.bind(this), { passive: false });
    this.canvas.addEventListener("touchmove", this._handleTouchMove.bind(this), { passive: false });
    this.canvas.addEventListener("touchend", this._handleMouseUp.bind(this));

    // Undo / Redo / Clear / Save / Close
    document.getElementById("btnUndo").addEventListener("click", () => this.undo());
    document.getElementById("btnRedo").addEventListener("click", () => this.redo());
    document.getElementById("btnClearAnnotations").addEventListener("click", () => this.clear());
    document.getElementById("btnSaveAnnotations").addEventListener("click", () => this.save());
    document.getElementById("btnCloseAnnotator").addEventListener("click", () => this.close());

    // Keyboard shortcuts: ESC to close, Ctrl+Z to undo
    window.addEventListener("keydown", (e) => {
      if (!this.modal.classList.contains("active")) return;
      if (e.key === "Escape") this.close();
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      }
    });
  }

  open(sideKey, imageSource, existingAnnotations = [], onSave) {
    this.currentSide = sideKey;
    this.annotations = JSON.parse(JSON.stringify(existingAnnotations || []));
    this.redoStack = [];
    this.onSaveCallback = onSave;

    // Reset custom defect form
    const form = document.getElementById("customDefectForm");
    const btnToggle = document.getElementById("btnToggleAddDefect");
    if (form) form.style.display = "none";
    if (btnToggle) btnToggle.style.display = "flex";

    this._renderCustomTags();

    document.getElementById("annotatorSideTitle").textContent = `${sideKey.toUpperCase()} VIEW DAMAGE MARKER`;

    this.baseImage = new Image();
    this.baseImage.onload = () => {
      // Set canvas size matching image aspect ratio
      const maxW = 900;
      const maxH = 650;
      let w = this.baseImage.width;
      let h = this.baseImage.height;

      if (w > maxW || h > maxH) {
        const scale = Math.min(maxW / w, maxH / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }

      this.canvas.width = w;
      this.canvas.height = h;

      this.render();
      this.modal.classList.add("active");
    };
    this.baseImage.src = imageSource;
  }

  close() {
    const form = document.getElementById("customDefectForm");
    const btnToggle = document.getElementById("btnToggleAddDefect");
    if (form) form.style.display = "none";
    if (btnToggle) btnToggle.style.display = "flex";

    this.modal.classList.remove("active");
  }

  _getCanvasCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;

    const clientX = e.clientX !== undefined ? e.clientX : e.touches[0].clientX;
    const clientY = e.clientY !== undefined ? e.clientY : e.touches[0].clientY;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }

  _handleMouseDown(e) {
    const coords = this._getCanvasCoords(e);
    this.isDrawing = true;
    this.startX = coords.x;
    this.startY = coords.y;
    this.currentPoints = [coords];
  }

  _handleTouchStart(e) {
    e.preventDefault();
    this._handleMouseDown(e);
  }

  _handleMouseMove(e) {
    if (!this.isDrawing) return;
    const coords = this._getCanvasCoords(e);

    if (this.activeTool === "pen") {
      this.currentPoints.push(coords);
      this.render();
      this._drawCurrentPen();
    } else {
      this.render();
      this._drawCurrentShape(coords);
    }
  }

  _handleTouchMove(e) {
    e.preventDefault();
    this._handleMouseMove(e);
  }

  _handleMouseUp(e) {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    let endCoords = { x: this.startX, y: this.startY };
    if (e.clientX !== undefined || (e.changedTouches && e.changedTouches.length)) {
      const clientX = e.clientX !== undefined ? e.clientX : e.changedTouches[0].clientX;
      const clientY = e.clientY !== undefined ? e.clientY : e.changedTouches[0].clientY;
      const rect = this.canvas.getBoundingClientRect();
      endCoords = {
        x: (clientX - rect.left) * (this.canvas.width / rect.width),
        y: (clientY - rect.top) * (this.canvas.height / rect.height)
      };
    }

    const dist = Math.hypot(endCoords.x - this.startX, endCoords.y - this.startY);
    // Ignore tiny accidental clicks
    if (dist < 4 && this.activeTool !== "pen") return;

    const item = {
      tool: this.activeTool,
      tag: this.activeTag.id,
      tag_label: this.activeTag.label,
      color: this.activeTag.color,
      startX: this.startX,
      startY: this.startY,
      endX: endCoords.x,
      endY: endCoords.y,
      points: this.activeTool === "pen" ? [...this.currentPoints] : null
    };

    this.annotations.push(item);
    this.redoStack = [];
    this.render();
  }

  _drawCurrentShape(coords) {
    this.ctx.save();
    this.ctx.strokeStyle = this.activeTag.color;
    this.ctx.lineWidth = this.strokeWidth;
    this.ctx.setLineDash([4, 4]);

    if (this.activeTool === "circle") {
      const rx = Math.abs(coords.x - this.startX) / 2;
      const ry = Math.abs(coords.y - this.startY) / 2;
      const cx = Math.min(this.startX, coords.x) + rx;
      const cy = Math.min(this.startY, coords.y) + ry;

      this.ctx.beginPath();
      this.ctx.ellipse(cx, cy, Math.max(rx, 4), Math.max(ry, 4), 0, 0, Math.PI * 2);
      this.ctx.stroke();
    } else if (this.activeTool === "rect") {
      const w = coords.x - this.startX;
      const h = coords.y - this.startY;
      this.ctx.strokeRect(this.startX, this.startY, w, h);
    } else if (this.activeTool === "arrow") {
      this._drawArrow(this.startX, this.startY, coords.x, coords.y, this.activeTag.color, true);
    }

    this.ctx.restore();
  }

  _drawCurrentPen() {
    if (this.currentPoints.length < 2) return;
    this.ctx.save();
    this.ctx.strokeStyle = this.activeTag.color;
    this.ctx.lineWidth = this.strokeWidth + 1;
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";

    this.ctx.beginPath();
    this.ctx.moveTo(this.currentPoints[0].x, this.currentPoints[0].y);
    for (let i = 1; i < this.currentPoints.length; i++) {
      this.ctx.lineTo(this.currentPoints[i].x, this.currentPoints[i].y);
    }
    this.ctx.stroke();
    this.ctx.restore();
  }

  _drawArrow(fromX, fromY, toX, toY, color, isDashed = false) {
    const headlen = 14;
    const angle = Math.atan2(toY - fromY, toX - fromX);

    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.fillStyle = color;
    this.ctx.lineWidth = this.strokeWidth;
    if (isDashed) this.ctx.setLineDash([4, 4]);

    this.ctx.beginPath();
    this.ctx.moveTo(fromX, fromY);
    this.ctx.lineTo(toX, toY);
    this.ctx.stroke();

    this.ctx.setLineDash([]);
    this.ctx.beginPath();
    this.ctx.moveTo(toX, toY);
    this.ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 6), toY - headlen * Math.sin(angle - Math.PI / 6));
    this.ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 6), toY - headlen * Math.sin(angle + Math.PI / 6));
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.restore();
  }

  render() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw base car image
    if (this.baseImage) {
      this.ctx.drawImage(this.baseImage, 0, 0, this.canvas.width, this.canvas.height);
    }

    // Draw saved annotations
    for (const item of this.annotations) {
      this.ctx.save();
      this.ctx.strokeStyle = item.color;
      this.ctx.fillStyle = item.color;
      this.ctx.lineWidth = this.strokeWidth;
      this.ctx.shadowColor = item.color;
      this.ctx.shadowBlur = 8;

      let labelX = item.startX;
      let labelY = item.startY;

      if (item.tool === "circle") {
        const rx = Math.abs(item.endX - item.startX) / 2;
        const ry = Math.abs(item.endY - item.startY) / 2;
        const cx = Math.min(item.startX, item.endX) + rx;
        const cy = Math.min(item.startY, item.endY) + ry;

        this.ctx.beginPath();
        this.ctx.ellipse(cx, cy, Math.max(rx, 4), Math.max(ry, 4), 0, 0, Math.PI * 2);
        this.ctx.stroke();

        labelX = cx;
        labelY = cy - ry - 14;
      } else if (item.tool === "rect") {
        const w = item.endX - item.startX;
        const h = item.endY - item.startY;
        this.ctx.strokeRect(item.startX, item.startY, w, h);
        labelX = item.startX;
        labelY = item.startY - 14;
      } else if (item.tool === "arrow") {
        this._drawArrow(item.startX, item.startY, item.endX, item.endY, item.color, false);
        labelX = item.endX;
        labelY = item.endY - 14;
      } else if (item.tool === "pen" && item.points && item.points.length > 1) {
        this.ctx.lineCap = "round";
        this.ctx.lineJoin = "round";
        this.ctx.beginPath();
        this.ctx.moveTo(item.points[0].x, item.points[0].y);
        for (let i = 1; i < item.points.length; i++) {
          this.ctx.lineTo(item.points[i].x, item.points[i].y);
        }
        this.ctx.stroke();
        labelX = item.points[0].x;
        labelY = item.points[0].y - 14;
      }

      // Draw Badge Label (e.g. "Dent", "Paint Scratch")
      this._drawTagBadge(labelX, labelY, item.tag_label, item.color);

      this.ctx.restore();
    }
  }

  _drawTagBadge(x, y, text, color) {
    this.ctx.save();
    this.ctx.font = "bold 11px 'Plus Jakarta Sans', sans-serif";
    const textW = this.ctx.measureText(text).width;
    const padX = 8;
    const padY = 4;
    const boxW = textW + padX * 2;
    const boxH = 18;

    const clampX = Math.max(10, Math.min(this.canvas.width - boxW - 10, x - boxW / 2));
    const clampY = Math.max(20, y);

    // Pill background
    this.ctx.fillStyle = "rgba(10, 14, 25, 0.85)";
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    this.ctx.roundRect(clampX, clampY - 12, boxW, boxH, 8);
    this.ctx.fill();
    this.ctx.stroke();

    // Text
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillText(text, clampX + padX, clampY + 2);
    this.ctx.restore();
  }

  undo() {
    if (this.annotations.length > 0) {
      this.redoStack.push(this.annotations.pop());
      this.render();
    }
  }

  redo() {
    if (this.redoStack.length > 0) {
      this.annotations.push(this.redoStack.pop());
      this.render();
    }
  }

  clear() {
    if (this.annotations.length > 0) {
      this.redoStack = [...this.annotations];
      this.annotations = [];
      this.render();
    }
  }

  save() {
    // Generate annotated composite data URL
    const compositeB64 = this.canvas.toDataURL("image/jpeg", 0.9);
    if (this.onSaveCallback) {
      this.onSaveCallback(this.currentSide, compositeB64, this.annotations);
    }
    this.close();
  }
}

// Instantiate globally
window.damageAnnotator = new DamageAnnotator();
