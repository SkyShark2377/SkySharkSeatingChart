/**
 * 2D Interactive Layout Engine (Fabric.js Controls)
 */
const CanvasEngine = {
    fabricCanvas: null,
    gridSize: 6,
    isSnapEnabled: true,
    roomInchesW: 360, 
    roomInchesH: 300, 
    STORAGE_KEY: 'ClassroomSeatingSuite_CanvasLayout_v1',
    isDragging: false,
    lastPosX: 0,
    lastPosY: 0,

    init(canvasId, initWInches = 360, initHInches = 300) {
        this.roomInchesW = initWInches;
        this.roomInchesH = initHInches;
        
        this.fabricCanvas = new fabric.Canvas(canvasId, {
            backgroundColor: '#ffffff'
        });

        this.attachControlListeners();

        const container = document.getElementById('canvasParentFrame');
        if (container) {
            const observer = new ResizeObserver(() => {
                this.recalculateDimensions();
            });
            observer.observe(container);
        }
    },

    zoomCanvas(factor) {
        if (!this.fabricCanvas) return;
        let zoom = this.fabricCanvas.getZoom() * factor;
        if (zoom > 5) zoom = 5;
        if (zoom < 0.1) zoom = 0.1;
        const center = this.fabricCanvas.getVpCenter();
        this.fabricCanvas.zoomToPoint(new fabric.Point(center.x, center.y), zoom);
    },

    saveLayout(periodId = null) {
        if (!this.fabricCanvas) return;
        const furnitureManifest = [];
        const assignments = {};

        const activePeriod = periodId || (window.VueAppBridge && window.VueAppBridge.getActivePeriodId ? window.VueAppBridge.getActivePeriodId() : null);

        this.fabricCanvas.getObjects().forEach(obj => {
            if (obj.isFurniture) {
                furnitureManifest.push({
                    left: obj.left,
                    top: obj.top,
                    angle: obj.angle,
                    scaleX: obj.scaleX,
                    scaleY: obj.scaleY,
                    furnitureId: obj.furnitureId,
                    furnitureType: obj.furnitureType,
                    blueprint: obj.blueprint
                });

                if (obj.seats) {
                    obj.seats.forEach(s => {
                        if (s.assignedStudentId || s.isLocked) { // Ensure empty-but-locked desks get saved
                            assignments[obj.furnitureId + '_' + s.seatIndex] = {
                                assignedStudentId: s.assignedStudentId,
                                isLocked: s.isLocked
                            };
                        }
                    });
                }
            }
        });

        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(furnitureManifest));

        if (activePeriod && activePeriod !== 'null') {
            localStorage.setItem('ClassroomSeatingSuite_Assignments_' + activePeriod, JSON.stringify(assignments));
        }
    },

    loadLayout(periodId = null) {
        if (!this.fabricCanvas) return;
        
        const savedLayout = localStorage.getItem(this.STORAGE_KEY);
        if (!savedLayout) {
            this.drawBackgroundGrid();
            return;
        }

        const activePeriod = periodId || (window.VueAppBridge && window.VueAppBridge.getActivePeriodId ? window.VueAppBridge.getActivePeriodId() : null);
        let assignments = {};

        if (activePeriod && activePeriod !== 'null') {
            const savedAssigns = localStorage.getItem('ClassroomSeatingSuite_Assignments_' + activePeriod);
            if (savedAssigns) {
                try {
                    assignments = JSON.parse(savedAssigns);
                } catch (e) { console.error("Assignments profile fetch aborted.", e); }
            }
        }

        try {
            const furnitureManifest = JSON.parse(savedLayout);
            
            const currentObjects = [...this.fabricCanvas.getObjects()];
            currentObjects.forEach(obj => {
                if (obj.isFurniture) this.fabricCanvas.remove(obj);
            });

            furnitureManifest.forEach(f => {
                let deskGroup = null;

                if (f.furnitureType === 'row' || f.furnitureType === 'single' || f.furnitureType === 'pod') {
                    const count = f.blueprint.count || (f.furnitureType === 'pod' ? f.blueprint.length : 1);
                    const totalSeats = f.furnitureType === 'pod' ? count * 2 : count;
                    const recreatedSeatsData = [];

                    for (let i = 0; i < totalSeats; i++) {
                        const key = f.furnitureId + '_' + i;
                        recreatedSeatsData.push(assignments[key] ? 
                            { seatIndex: i, assignedStudentId: assignments[key].assignedStudentId, isLocked: assignments[key].isLocked } : 
                            { seatIndex: i, assignedStudentId: null, isLocked: false });
                    }

                    if (f.furnitureType === 'row' || f.furnitureType === 'single') {
                        deskGroup = this.buildRowObject(count, f.blueprint.dW, f.blueprint.dL, recreatedSeatsData);
                    } else if (f.furnitureType === 'pod') {
                        deskGroup = this.buildPodObject(f.blueprint.length, f.blueprint.dW, f.blueprint.dL, recreatedSeatsData);
                    }
                } else {
                    deskGroup = this.buildAssetObject(f.furnitureType, f.blueprint.width, f.blueprint.height, f.blueprint.fill, f.blueprint.stroke, f.blueprint.label, f.blueprint.textFill, f.blueprint.shape);
                }

                if (deskGroup) {
                    deskGroup.set({
                        left: f.left,
                        top: f.top,
                        angle: f.angle,
                        scaleX: f.scaleX,
                        scaleY: f.scaleY
                    });

                    deskGroup.getObjects().forEach(child => {
                        if (child.type === 'textbox' || child.type === 'text') {
                            child.set({ scaleX: 1 / f.scaleX, scaleY: 1 / f.scaleY });
                        }
                    });

                    deskGroup.furnitureId = f.furnitureId;
                    deskGroup.setCoords(); 
                    this.fabricCanvas.add(deskGroup);
                }
            });

            this.drawBackgroundGrid();
            this.fabricCanvas.renderAll();
            
            if (window.VueAppBridge && window.VueAppBridge.incrementNonce) window.VueAppBridge.incrementNonce();
        } catch (error) {
            console.error("Layout restoration stream interrupted.", error);
        }
    },

    getGlobalSeatCenter(group, seatObj) {
        const matrix = group.calcTransformMatrix();
        const localCenter = seatObj.rectObj.getCenterPoint();
        return fabric.util.transformPoint(localCenter, matrix);
    },

    getSeatAtPointer(group, globalPointer) {
        let closestSeat = null;
        let minDistance = 999999;

        if (!group.seats) return null;

        group.seats.forEach(seat => {
            const globalCenter = this.getGlobalSeatCenter(group, seat);
            const dx = globalCenter.x - globalPointer.x;
            const dy = globalCenter.y - globalPointer.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < minDistance) {
                minDistance = dist;
                closestSeat = seat;
            }
        });
        return closestSeat;
    },

    buildSingleDeskObject(dW, dL, savedSeatsData = null) {
        return this.buildRowObject(1, dW, dL, savedSeatsData);
    },

    buildRowObject(count, dW, dL, savedSeatsData = null) {
        const parts = []; const seatRefs = [];
        for (let i = 0; i < count; i++) {
            let offX = i * (dW + 2);
            const rect = new fabric.Rect({ left: offX, top: 0, width: dW, height: dL, fill: '#fef3c7', stroke: '#d97706', strokeWidth: 1.5, rx: 2, ry: 2 });
            const chair = new fabric.Circle({ left: offX + (dW / 2) - 4, top: dL - 4, radius: 4, stroke: '#b45309', strokeWidth: 1.5, fill: '#fcd34d' });
            
            let studentId = null; let isLocked = false; let textLabel = "Empty Seat";
            
            // Rebuild labels cleanly based on lock/assignment status
            if (savedSeatsData && savedSeatsData[i]) {
                studentId = savedSeatsData[i].assignedStudentId;
                isLocked = savedSeatsData[i].isLocked;
                
                if (studentId && window.VueAppBridge) {
                    textLabel = window.VueAppBridge.lookupStudentName(studentId);
                } else if (isLocked) {
                    textLabel = "Blocked";
                }
                
                if (isLocked) textLabel = "🔒 " + textLabel;
            }

            const label = new fabric.Textbox(textLabel, { 
                left: offX + (dW / 2), top: dL / 2, width: dW - 4, 
                fontSize: 4, fontFamily: 'sans-serif', fill: '#78350f', 
                originX: 'center', originY: 'center', textAlign: 'center', fontWeight: 'bold' 
            });
            
            parts.push(rect, chair, label);
            seatRefs.push({ seatIndex: i, assignedStudentId: studentId, isLocked, rectObj: rect, textObj: label });
        }
        const group = new fabric.Group(parts, { hasRotatingPoint: true, cornerSize: 8 });
        group.isFurniture = true;
        group.furnitureType = count === 1 ? 'single' : 'row';
        group.blueprint = { type: group.furnitureType, count, dW, dL };
        group.seats = seatRefs;
        return group;
    },

    buildPodObject(length, dW, dL, savedSeatsData = null) {
        const parts = []; const seatRefs = [];
        let seatCounter = 0;

        for (let i = 0; i < length; i++) {
            let offX = i * (dW + 2); let offY = 0;
            const rect = new fabric.Rect({ left: offX, top: offY, width: dW, height: dL, fill: '#fef3c7', stroke: '#d97706', strokeWidth: 1.5, rx: 2, ry: 2 });
            const chair = new fabric.Circle({ left: offX + (dW / 2) - 4, top: offY - 2, radius: 4, stroke: '#b45309', strokeWidth: 1.5, fill: '#fcd34d' });
            
            let studentId = null; let isLocked = false; let textLabel = "Empty Seat";
            
            if (savedSeatsData && savedSeatsData[seatCounter]) {
                studentId = savedSeatsData[seatCounter].assignedStudentId;
                isLocked = savedSeatsData[seatCounter].isLocked;
                
                if (studentId && window.VueAppBridge) {
                    textLabel = window.VueAppBridge.lookupStudentName(studentId);
                } else if (isLocked) {
                    textLabel = "Blocked";
                }
                
                if (isLocked) textLabel = "🔒 " + textLabel;
            }

            const label = new fabric.Textbox(textLabel, { 
                left: offX + (dW / 2), top: offY + (dL / 2), width: dW - 4, 
                fontSize: 4, fontFamily: 'sans-serif', fill: '#78350f', 
                originX: 'center', originY: 'center', textAlign: 'center', fontWeight: 'bold' 
            });
            
            parts.push(rect, chair, label);
            seatRefs.push({ seatIndex: seatCounter, row: 0, col: i, assignedStudentId: studentId, isLocked, rectObj: rect, textObj: label });
            seatCounter++;
        }

        for (let i = 0; i < length; i++) {
            let offX = i * (dW + 2); let offY = dL + 4; 
            const rect = new fabric.Rect({ left: offX, top: offY, width: dW, height: dL, fill: '#fef3c7', stroke: '#d97706', strokeWidth: 1.5, rx: 2, ry: 2 });
            const chair = new fabric.Circle({ left: offX + (dW / 2) - 4, top: offY + dL - 6, radius: 4, stroke: '#b45309', strokeWidth: 1.5, fill: '#fcd34d' });
            
            let studentId = null; let isLocked = false; let textLabel = "Empty Seat";
            
            if (savedSeatsData && savedSeatsData[seatCounter]) {
                studentId = savedSeatsData[seatCounter].assignedStudentId;
                isLocked = savedSeatsData[seatCounter].isLocked;
                
                if (studentId && window.VueAppBridge) {
                    textLabel = window.VueAppBridge.lookupStudentName(studentId);
                } else if (isLocked) {
                    textLabel = "Blocked";
                }
                
                if (isLocked) textLabel = "🔒 " + textLabel;
            }

            const label = new fabric.Textbox(textLabel, { 
                left: offX + (dW / 2), top: offY + (dL / 2), width: dW - 4, 
                fontSize: 4, fontFamily: 'sans-serif', fill: '#78350f', 
                originX: 'center', originY: 'center', textAlign: 'center', fontWeight: 'bold' 
            });
            
            parts.push(rect, chair, label);
            seatRefs.push({ seatIndex: seatCounter, row: 1, col: i, assignedStudentId: studentId, isLocked, rectObj: rect, textObj: label });
            seatCounter++;
        }

        const group = new fabric.Group(parts, { hasRotatingPoint: true, cornerSize: 8 });
        group.isFurniture = true;
        group.furnitureType = 'pod';
        group.blueprint = { type: 'pod', length, dW, dL };
        group.seats = seatRefs;
        return group;
    },

    spawnAsset(assetType) {
        let width = 48, height = 48, fill = '#e2e8f0', stroke = '#94a3b8', label = 'Asset', textFill = '#475569', shape = 'rect';
        
        switch (assetType) {
            case 'teacher_desk': width = 60; height = 30; fill = '#cbd5e1'; stroke = '#64748b'; label = 'Teacher Desk'; textFill = '#334155'; break;
            case 'rug': width = 120; height = 96; fill = 'rgba(56, 189, 248, 0.2)'; stroke = '#0284c7'; label = 'Rect Rug / Zone'; textFill = '#0369a1'; break;
            case 'bookshelf': width = 48; height = 18; fill = '#fcd34d'; stroke = '#b45309'; label = 'Bookshelves'; textFill = '#78350f'; break;
            case 'locker': width = 72; height = 18; fill = '#94a3b8'; stroke = '#475569'; label = 'Lockers'; textFill = '#1e293b'; break;
            case 'smartboard': width = 96; height = 8; fill = '#1e293b'; stroke = '#0f172a'; label = 'Smartboard'; textFill = '#ffffff'; break;
            case 'door': width = 36; height = 8; fill = '#ef4444'; stroke = '#991b1b'; label = 'Door'; textFill = '#ffffff'; break;
            case 'window': width = 60; height = 8; fill = '#7dd3fc'; stroke = '#0284c7'; label = 'Window'; textFill = '#000000'; break;
            case 'rug_circle': width = 96; height = 96; fill = 'rgba(56, 189, 248, 0.2)'; stroke = '#0284c7'; label = 'Round Rug'; textFill = '#0369a1'; shape = 'circle'; break;
            case 'rug_half': width = 96; height = 48; fill = 'rgba(56, 189, 248, 0.2)'; stroke = '#0284c7'; label = 'Half Rug'; textFill = '#0369a1'; shape = 'half_circle'; break;
            case 'table_round': width = 48; height = 48; fill = '#cbd5e1'; stroke = '#64748b'; label = 'Round Table'; textFill = '#334155'; shape = 'circle'; break;
            case 'table_half': width = 60; height = 30; fill = '#cbd5e1'; stroke = '#64748b'; label = 'Half Table'; textFill = '#334155'; shape = 'half_circle'; break;
        }

        const group = this.buildAssetObject(assetType, width, height, fill, stroke, label, textFill, shape);
        
        const center = this.fabricCanvas.getVpCenter();
        group.set({ left: center.x - (width/2), top: center.y - (height/2) }); 
        
        group.furnitureId = 'asset_' + Math.random().toString(36).substr(2, 9).toUpperCase();
        this.fabricCanvas.add(group).setActiveObject(group).renderAll(); 
        this.saveLayout();
    },

    buildAssetObject(assetType, width, height, fill, stroke, labelText, textFill, shape = 'rect') {
        let baseShape;
        
        if (shape === 'circle') {
            baseShape = new fabric.Circle({
                left: 0, top: 0, radius: width / 2,
                fill: fill, stroke: stroke, strokeWidth: 2
            });
        } else if (shape === 'half_circle') {
            const pathStr = `M 0 ${height} A ${width/2} ${height} 0 0 1 ${width} ${height} Z`;
            baseShape = new fabric.Path(pathStr, {
                left: 0, top: 0, fill: fill, stroke: stroke, strokeWidth: 2
            });
        } else {
            baseShape = new fabric.Rect({ 
                left: 0, top: 0, width: width, height: height, 
                fill: fill, stroke: stroke, strokeWidth: 2, rx: (assetType.includes('rug') ? 12 : 2), ry: (assetType.includes('rug') ? 12 : 2) 
            });
        }
        
        const label = new fabric.Textbox(labelText, { 
            left: width / 2, top: height / 2, width: width - 4, 
            fontSize: (assetType === 'smartboard' || assetType === 'door' || assetType === 'window') ? 6 : 10, 
            fontFamily: 'sans-serif', fill: textFill || stroke, 
            originX: 'center', originY: 'center', textAlign: 'center', fontWeight: 'bold' 
        });

        if (shape === 'half_circle') {
            label.set({ top: height * 0.65 });
        }
        
        const group = new fabric.Group([baseShape, label], { hasRotatingPoint: true, cornerSize: 8 });
        
        group.isFurniture = true; 
        group.furnitureType = assetType;
        group.blueprint = { width, height, fill, stroke, label: labelText, textFill: textFill || stroke, shape };
        return group;
    },

    spawnRow(count, dW, dL) {
        const group = this.buildRowObject(count, dW, dL);
        const center = this.fabricCanvas.getVpCenter();
        group.set({ left: center.x, top: center.y }); 
        group.furnitureId = 'furn_' + Math.random().toString(36).substr(2, 9).toUpperCase();
        this.fabricCanvas.add(group).setActiveObject(group).renderAll(); 
        this.saveLayout();
    },

    spawnPod(length, dW, dL) {
        const group = this.buildPodObject(length, dW, dL);
        const center = this.fabricCanvas.getVpCenter();
        group.set({ left: center.x, top: center.y }); 
        group.furnitureId = 'furn_' + Math.random().toString(36).substr(2, 9).toUpperCase();
        this.fabricCanvas.add(group).setActiveObject(group).renderAll(); 
        this.saveLayout();
    },

    assignStudentToSeatObject(group, seatObj, studentId, studentName, isLocked = false) {
        if (studentId) {
            const allFurniture = this.fabricCanvas.getObjects().filter(o => o.isFurniture);
            allFurniture.forEach(g => {
                if (g.seats) {
                    g.seats.forEach(s => {
                        if (s.assignedStudentId === studentId && (g !== group || s !== seatObj)) {
                            s.assignedStudentId = null;
                            s.isLocked = false;
                            s.textObj.set({ text: "Empty Seat" });
                        }
                    });
                }
            });
        }

        seatObj.assignedStudentId = studentId || null;
        seatObj.isLocked = isLocked;

        // Display logic for Locked, Unlocked, Empty, and Blocked
        let labelText = studentName || (isLocked ? "Blocked" : "Empty Seat");
        if (seatObj.isLocked) labelText = "🔒 " + labelText;

        seatObj.textObj.set({ text: labelText });
        this.fabricCanvas.renderAll();
        this.saveLayout();

        if (window.VueAppBridge && window.VueAppBridge.incrementNonce) window.VueAppBridge.incrementNonce();
    },

    validateSeatingLayout(students, minDistanceInches) {
        if (!this.fabricCanvas) return;
        const furnitureGroups = this.fabricCanvas.getObjects().filter(o => o.isFurniture && o.seats);

        furnitureGroups.forEach(g => g.seats.forEach(s => s.rectObj.set({ fill: '#fef3c7', stroke: '#d97706' })));

        const allSeatsPool = [];
        furnitureGroups.forEach(g => g.seats.forEach(s => allSeatsPool.push({ group: g, seat: s })));

        for (let i = 0; i < allSeatsPool.length; i++) {
            for (let j = i + 1; j < allSeatsPool.length; j++) {
                const nodeA = allSeatsPool[i]; const nodeB = allSeatsPool[j];

                if (!nodeA.seat.assignedStudentId || !nodeB.seat.assignedStudentId) continue;

                const studentA = students[nodeA.seat.assignedStudentId];
                const studentB = students[nodeB.seat.assignedStudentId];
                if (!studentA || !studentB) continue;

                const hasRestriction = studentA.restrictedStudentIds.includes(studentB.id) || 
                                      studentB.restrictedStudentIds.includes(studentA.id);

                if (hasRestriction) {
                    let isViolated = false;

                    if (nodeA.group === nodeB.group && nodeA.group.furnitureType === 'row') {
                        if (Math.abs(nodeA.seat.seatIndex - nodeB.seat.seatIndex) < 3) isViolated = true;
                    }
                    if (nodeA.group === nodeB.group && nodeA.group.furnitureType === 'pod') {
                        const len = nodeA.group.blueprint.length || 3;
                        if (len <= 3) {
                            isViolated = true;
                        } else {
                            const isOppositeCorner = (Math.abs(nodeA.seat.row - nodeB.seat.row) === 1) && (Math.abs(nodeA.seat.col - nodeB.seat.col) === len - 1);
                            if (!isOppositeCorner) isViolated = true;
                        }
                    }
                    const posA = this.getGlobalSeatCenter(nodeA.group, nodeA.seat);
                    const posB = this.getGlobalSeatCenter(nodeB.group, nodeB.seat);
                    const distance = Math.sqrt(Math.pow(posA.x - posB.x, 2) + Math.pow(posA.y - posB.y, 2));

                    if (distance < minDistanceInches) isViolated = true;

                    if (isViolated) {
                        nodeA.seat.rectObj.set({ fill: '#fee2e2', stroke: '#dc2626' });
                        nodeB.seat.rectObj.set({ fill: '#fee2e2', stroke: '#dc2626' });
                    }
                }
            }
        }
        this.fabricCanvas.renderAll();
    },

    clear() {
        if (!this.fabricCanvas) return;
        const currentObjects = [...this.fabricCanvas.getObjects()];
        currentObjects.forEach(obj => { if (obj.isFurniture) this.fabricCanvas.remove(obj); });
        this.drawBackgroundGrid(); this.saveLayout();
        window.dispatchEvent(new CustomEvent('canvas-layout-modified'));
    },

    drawBackgroundGrid() {
        if (!this.fabricCanvas) return;

        const historicalDecorations = this.fabricCanvas.getObjects().filter(obj => obj.isBackgroundDecoration);
        historicalDecorations.forEach(obj => this.fabricCanvas.remove(obj));

        const len = this.gridSize;
        const freshDecorations = [];

        for (let i = 0; i <= (this.roomInchesW / len); i++) {
            freshDecorations.push(new fabric.Line([i * len, 0, i * len, this.roomInchesH], { stroke: '#f1f5f9', selectable: false, evented: false, isBackgroundDecoration: true }));
        }
        for (let i = 0; i <= (this.roomInchesH / len); i++) {
            freshDecorations.push(new fabric.Line([0, i * len, this.roomInchesW, i * len], { stroke: '#f1f5f9', selectable: false, evented: false, isBackgroundDecoration: true }));
        }

        const borderThickness = 4;
        const borderScaleRatio = borderThickness / this.fabricCanvas.getZoom();
        
        const wallRect = new fabric.Rect({
            left: 0, 
            top: 0, 
            width: this.roomInchesW, 
            height: this.roomInchesH,
            fill: 'transparent', 
            stroke: '#1e293b', 
            strokeWidth: borderScaleRatio > 0.5 ? borderScaleRatio : 1,
            selectable: false, 
            evented: false, 
            isBackgroundDecoration: true
        });
        freshDecorations.push(wallRect);

        freshDecorations.reverse().forEach(obj => this.fabricCanvas.insertAt(obj, 0, false));
        this.fabricCanvas.renderAll();
    },

    recalculateDimensions() {
        const container = document.getElementById('canvasParentFrame');
        if (!container || !this.fabricCanvas) return;

        const rect = container.getBoundingClientRect();
        let containerW = rect.width;
        let containerH = rect.height;
        
        if (containerW < 50 || containerH < 50) return;

        const scale = Math.min(containerW / this.roomInchesW, containerH / this.roomInchesH) * 0.95;

        this.fabricCanvas.setDimensions({ width: containerW, height: containerH });
        this.fabricCanvas.setZoom(scale);

        const scaledRoomWidth = this.roomInchesW * scale;
        const scaledRoomHeight = this.roomInchesH * scale;
        
        const offsetX = (containerW - scaledRoomWidth) / 2;
        const offsetY = (containerH - scaledRoomHeight) / 2;

        this.fabricCanvas.viewportTransform[4] = offsetX;
        this.fabricCanvas.viewportTransform[5] = offsetY;

        this.drawBackgroundGrid();

        this.fabricCanvas.getObjects().forEach(obj => { 
            if (obj.isFurniture) obj.setCoords(); 
        });
        this.fabricCanvas.renderAll();
    },

    attachControlListeners() {
        this.fabricCanvas.on('mouse:wheel', (opt) => {
            const delta = opt.e.deltaY;
            let zoom = this.fabricCanvas.getZoom();
            zoom *= 0.999 ** delta;
            if (zoom > 5) zoom = 5;
            if (zoom < 0.1) zoom = 0.1;
            this.fabricCanvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
            opt.e.preventDefault();
            opt.e.stopPropagation();
        });

        this.fabricCanvas.on('mouse:down', (options) => {
            const e = options.e;
            
            if (e.altKey && options.target && options.target.isFurniture) {
                const seat = this.getSeatAtPointer(options.target, this.fabricCanvas.getPointer(e));
                if (seat && seat.assignedStudentId && !seat.isLocked) {
                    this.assignStudentToSeatObject(options.target, seat, null, "Empty Seat", false);
                    window.dispatchEvent(new CustomEvent('canvas-layout-modified'));
                }
            }
            
            if (e.shiftKey || e.button === 1) {
                this.isDragging = true;
                this.fabricCanvas.selection = false;
                this.lastPosX = e.clientX;
                this.lastPosY = e.clientY;
            }
        });

        this.fabricCanvas.on('mouse:move', (options) => {
            if (this.isDragging) {
                const e = options.e;
                const vpt = this.fabricCanvas.viewportTransform;
                vpt[4] += e.clientX - this.lastPosX;
                vpt[5] += e.clientY - this.lastPosY;
                this.fabricCanvas.requestRenderAll();
                this.lastPosX = e.clientX;
                this.lastPosY = e.clientY;
            }
        });

        this.fabricCanvas.on('mouse:up', () => {
            this.isDragging = false;
            this.fabricCanvas.selection = true;
            this.fabricCanvas.getObjects().forEach(obj => obj.setCoords()); 
        });

        this.fabricCanvas.on('object:moving', (options) => {
            if (!this.isSnapEnabled) return;
            let l = Math.round(options.target.left / this.gridSize) * this.gridSize;
            let t = Math.round(options.target.top / this.gridSize) * this.gridSize;
            
            const margin = -24; 
            options.target.set({ left: l < margin ? margin : l, top: t < margin ? margin : t });
        });

        this.fabricCanvas.on('object:scaling', (options) => {
            const obj = options.target;
            if (obj && obj.isFurniture) {
                obj.getObjects().forEach(child => {
                    if (child.type === 'textbox' || child.type === 'text') {
                        child.set({
                            scaleX: 1 / obj.scaleX,
                            scaleY: 1 / obj.scaleY
                        });
                    }
                });
            }
        });

        this.fabricCanvas.on('object:modified', () => { this.saveLayout(); window.dispatchEvent(new CustomEvent('canvas-layout-modified')); });

        // Double-click to lock/unlock seats
        this.fabricCanvas.upperCanvasEl.addEventListener('dblclick', (e) => {
            const pointer = this.fabricCanvas.getPointer(e);
            const activeObj = this.fabricCanvas.getActiveObject();
            if (activeObj && activeObj.isFurniture && activeObj.seats) {
                const targetedSeat = this.getSeatAtPointer(activeObj, pointer);
                
                // Allow lock toggle even if no student is assigned
                if (targetedSeat) {
                    targetedSeat.isLocked = !targetedSeat.isLocked;
                    
                    const name = targetedSeat.assignedStudentId && window.VueAppBridge ? window.VueAppBridge.lookupStudentName(targetedSeat.assignedStudentId) : '';
                    
                    this.assignStudentToSeatObject(activeObj, targetedSeat, targetedSeat.assignedStudentId, name, targetedSeat.isLocked);
                    window.dispatchEvent(new CustomEvent('canvas-layout-modified'));
                }
            }
        });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT') return;
                const activeObj = this.fabricCanvas.getActiveObject();
                if (activeObj && activeObj.isFurniture) { this.fabricCanvas.remove(activeObj); this.saveLayout(); window.dispatchEvent(new CustomEvent('canvas-layout-modified')); }
            }
        });
    },

    updateRoomSize(widthFeet, lengthFeet) { 
        this.roomInchesW = widthFeet * 12; 
        this.roomInchesH = lengthFeet * 12; 
        this.recalculateDimensions(); 
    },
    
    setSnap(enabled) { 
        this.isSnapEnabled = enabled; 
    }
};