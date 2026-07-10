const { createApp, ref, computed, watch, nextTick, onMounted } = Vue;

createApp({
    setup() {
        const currentTab = ref('layout');
        const isSidebarOpen = ref(true);
        const rosterUpdateNonce = ref(0); // Reactive update trigger
		const showInstructionsModal = ref(false);
        const STORAGE_KEY = 'ClassroomSeatingSuite_LocalPersistence_v1';

        // --- HYDRATION PERSISTENCE ENGINE ---
        const savedRawData = localStorage.getItem(STORAGE_KEY);
        let restoredState = {
            students: {}, periods: {}, roomWidthFeet: 30, roomLengthFeet: 25, globalDeskWidth: 24, globalDeskLength: 18, minSeparationInches: 48, activePeriodId: null, isDeskLockEnabled: false
        };

        if (savedRawData) {
            try {
                const parsed = JSON.parse(savedRawData);
                if (parsed && typeof parsed === 'object') restoredState = { ...restoredState, ...parsed };
            } catch (e) { console.error("Local data recovery stream interrupted.", e); }
        }

        // --- CORE STATES HOOKS ---
        const students = ref(restoredState.students || {});
        const periods = ref(restoredState.periods || {});
        const roomWidthFeet = ref(restoredState.roomWidthFeet);  
        const roomLengthFeet = ref(restoredState.roomLengthFeet); 
        const globalDeskWidth = ref(restoredState.globalDeskWidth);
        const globalDeskLength = ref(restoredState.globalDeskLength);
        const minSeparationInches = ref(restoredState.minSeparationInches || 48);

        const uiRowCount = ref(4);
        const uiPodLength = ref(3);
        const isSnapEnabled = ref(true);
        const isDeskLockEnabled = ref(restoredState.isDeskLockEnabled || false);

        // FIXED INITIALIZATION string context checks pulling the string key entry directly
        const periodKeysList = Object.keys(periods.value);
        const activeLayoutPeriodId = ref(restoredState.activePeriodId || (periodKeysList.length > 0 ? periodKeysList[0] : null));   
        const selectedPeriodId = ref(restoredState.activePeriodId || (periodKeysList.length > 0 ? periodKeysList[0] : null));   

        const newStudentForm = ref({ name: '', gender: 'Unspecified', preferredSeating: false });
        const newPeriodName = ref('');
        const editingStudentId = ref(null);
        const searchA = ref(''); const searchB = ref('');
        const selectedIdA = ref(null); const selectedIdB = ref(null);
        const showDropdownA = ref(false); const showDropdownB = ref(false);

        // --- GLOBAL APPMANAGER LOOKUP BRIDGE INTERACTION LINK ---
        window.VueAppBridge = {
            lookupStudentName(id) {
                return students.value[id] ? students.value[id].name : 'Unknown';
            },
            getActivePeriodId() {
                return activeLayoutPeriodId.value;
            },
            incrementNonce() {
                rosterUpdateNonce.value++;
            }
        };

        // --- COMPUTED ALIASES & TRACKERS ---
        const studentCount = computed(() => Object.keys(students.value).length);
        const periodCount = computed(() => Object.keys(periods.value).length);
        
        const currentSelectedPeriod = computed(() => {
            if (!selectedPeriodId.value || typeof selectedPeriodId.value !== 'string') return null;
            return periods.value[selectedPeriodId.value] || null;
        });

        const activePeriodStudents = computed(() => {
            if (!activeLayoutPeriodId.value || !periods.value[activeLayoutPeriodId.value]) return [];
            const ids = periods.value[activeLayoutPeriodId.value].studentIds || [];
            return Object.values(students.value).filter(s => ids.includes(s.id));
        });

        const unseatedRosterCount = computed(() => {
            rosterUpdateNonce.value; // register dependency
            return activePeriodStudents.value.filter(s => !isStudentSeatedOnCanvas(s.id)).length;
        });

        const availableStudentsForPeriod = computed(() => {
            if (!selectedPeriodId.value || !periods.value[selectedPeriodId.value]) return [];
            const assigned = periods.value[selectedPeriodId.value].studentIds || [];
            return Object.values(students.value).filter(s => !assigned.includes(s.id));
        });

        const assignedStudentsForPeriod = computed(() => {
            if (!selectedPeriodId.value || !periods.value[selectedPeriodId.value]) return [];
            const assigned = periods.value[selectedPeriodId.value].studentIds || [];
            return Object.values(students.value).filter(s => assigned.includes(s.id));
        });

        const filteredA = computed(() => { const q = searchA.value.toLowerCase(); return Object.values(students.value).filter(s => s.name.toLowerCase().includes(q) && s.id !== selectedIdB.value); });
        const filteredB = computed(() => { const q = searchB.value.toLowerCase(); return Object.values(students.value).filter(s => s.name.toLowerCase().includes(q) && s.id !== selectedIdA.value); });

        // --- AUTOMATED LOCAL STORAGE WATCHER LOOP ---
        watch(() => ({
            students: students.value, periods: periods.value, roomWidthFeet: roomWidthFeet.value, roomLengthFeet: roomLengthFeet.value, globalDeskWidth: globalDeskWidth.value, globalDeskLength: globalDeskLength.value, minSeparationInches: minSeparationInches.value, activePeriodId: activeLayoutPeriodId.value, isDeskLockEnabled: isDeskLockEnabled.value
        }), (snapshot) => { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); }, { deep: true });

        // --- CANVAS TRACKING HOOKS ---
        function isStudentSeatedOnCanvas(studentId) {
            rosterUpdateNonce.value; // register deep tracking dependency context loop parameters
            if (!CanvasEngine.fabricCanvas) return false;
            return CanvasEngine.fabricCanvas.getObjects().some(o => o.isFurniture && o.seats && o.seats.some(s => s.assignedStudentId === studentId));
        }

        function startEdit(s) {
            editingStudentId.value = s.id;
        }

        function saveEdit() {
            editingStudentId.value = null;
            CanvasEngine.loadLayout(activeLayoutPeriodId.value);
        }

        function triggerRosterValidation() {
            CanvasEngine.validateSeatingLayout(students.value, minSeparationInches.value);
            rosterUpdateNonce.value++;
        }

        function handleRosterDragStart(event, studentId) {
            event.dataTransfer.setData('text/plain', studentId);
        }

        function handleCanvasRosterDrop(event) {
            event.preventDefault();
            const studentId = event.dataTransfer ? event.dataTransfer.getData('text/plain') : '';
            if (!studentId || !students.value[studentId]) return;

            const pointer = CanvasEngine.fabricCanvas.getPointer(event);
            let closestNode = null;
            let minDistance = 999999; 

            const furnitureObjects = CanvasEngine.fabricCanvas.getObjects().filter(o => o.isFurniture);
            
            furnitureObjects.forEach(group => {
                if (group.seats) {
                    group.seats.forEach(seat => {
                        const globalCenter = CanvasEngine.getGlobalSeatCenter(group, seat);
                        const dx = globalCenter.x - pointer.x;
                        const dy = globalCenter.y - pointer.y;
                        const distance = Math.sqrt(dx * dx + dy * dy);

                        if (distance < minDistance) {
                            minDistance = distance;
                            closestNode = { group, seat };
                        }
                    });
                }
            });

            if (closestNode && minDistance <= 40) {
                const { group, seat } = closestNode;
                if (seat.isLocked) {
                    alert("This seat is locked. Double-click it to unlock it before changing students.");
                    return;
                }
                CanvasEngine.assignStudentToSeatObject(group, seat, studentId, students.value[studentId].name, false);
                triggerRosterValidation();
            }
        }

        // --- IMPORT / EXPORT ENGINE ---
        function exportData() {
            const vueStateData = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            const canvasLayoutData = JSON.parse(localStorage.getItem('ClassroomSeatingSuite_CanvasLayout_v1') || '[]');
            const assignmentsData = {};
            if (vueStateData.periods) {
                Object.keys(vueStateData.periods).forEach(periodId => {
                    const assignKey = 'ClassroomSeatingSuite_Assignments_' + periodId;
                    const assignData = localStorage.getItem(assignKey);
                    if (assignData) {
                        assignmentsData[periodId] = JSON.parse(assignData);
                    }
                });
            }

            const masterBundle = {
                version: "2.0",
                vueState: vueStateData,
                canvasLayout: canvasLayoutData,
                assignments: assignmentsData
            };

            const dataStr = JSON.stringify(masterBundle, null, 2); 
            const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
            
            const exportFileDefaultName = 'ClassroomSeatingData.json';
            const linkElement = document.createElement('a');
            linkElement.setAttribute('href', dataUri);
            linkElement.setAttribute('download', exportFileDefaultName);
            linkElement.click();
        }

        function importData(event) {
    const file = event.target.files ? event.target.files[0] : null;
    if (!file) {
        console.error("No file selected.");
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const importedData = JSON.parse(e.target.result);
            
            // 1. Restore the Vue state (including isDeskLockEnabled)
            if (importedData.vueState) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(importedData.vueState));
            }
            // 2. Restore the Canvas layout
            if (importedData.canvasLayout) {
                localStorage.setItem('ClassroomSeatingSuite_CanvasLayout_v1', JSON.stringify(importedData.canvasLayout));
            }
            // 3. Restore the assignments
            if (importedData.assignments) {
                Object.keys(importedData.assignments).forEach(periodId => {
                    localStorage.setItem('ClassroomSeatingSuite_Assignments_' + periodId, JSON.stringify(importedData.assignments[periodId]));
                });
            }

            alert("Data imported successfully! The application will now reload.");
            window.location.reload();
        } catch (err) { 
            console.error(err);
            alert("Invalid file format. Please ensure you are importing a valid Classroom Seating Data JSON file."); 
        }
    };
    reader.readAsText(file);
}

        function handleApplyRestriction() {
            const idA = selectedIdA.value;
            const idB = selectedIdB.value;
            
            if (!idA || !idB || idA === idB) return;
            if (!students.value[idA] || !students.value[idB]) return;

            if (!students.value[idA].restrictedStudentIds) students.value[idA].restrictedStudentIds = [];
            if (!students.value[idB].restrictedStudentIds) students.value[idB].restrictedStudentIds = [];

            if (!students.value[idA].restrictedStudentIds.includes(idB)) {
                students.value[idA].restrictedStudentIds = [...students.value[idA].restrictedStudentIds, idB];
            }
            if (!students.value[idB].restrictedStudentIds.includes(idA)) {
                students.value[idB].restrictedStudentIds = [...students.value[idB].restrictedStudentIds, idA];
            }

            searchA.value = ''; 
            searchB.value = '';
            selectedIdA.value = null; 
            selectedIdB.value = null;

            students.value = { ...students.value };
            triggerRosterValidation();
        }

        function handleLayoutPeriodChange() {
            if (!activeLayoutPeriodId.value || activeLayoutPeriodId.value === 'null') return;
            selectedPeriodId.value = activeLayoutPeriodId.value; 
            CanvasEngine.loadLayout(activeLayoutPeriodId.value);
            triggerRosterValidation();
        }

        // ================= ALGORITHMIC AUTO-ASSIGN ORCHESTRATION ENGINE =================
        function handleAutoAssign() {
            if (!CanvasEngine.fabricCanvas) return;

            const furnitureGroups = CanvasEngine.fabricCanvas.getObjects().filter(o => o.isFurniture && o.seats);
            const allSeatsPool = [];
            furnitureGroups.forEach(g => g.seats.forEach(s => allSeatsPool.push({ group: g, seat: s })));

            const unlockedSeatNodes = allSeatsPool.filter(n => !n.seat.isLocked);
            if (unlockedSeatNodes.length === 0) return;

            unlockedSeatNodes.sort((a, b) => {
                const posA = CanvasEngine.getGlobalSeatCenter(a.group, a.seat);
                const posB = CanvasEngine.getGlobalSeatCenter(b.group, b.seat);
                return posA.y - posB.y;
            });

            unlockedSeatNodes.forEach(n => CanvasEngine.assignStudentToSeatObject(n.group, n.seat, null, "Empty Seat", false));

            const lockedIds = allSeatsPool.filter(n => n.seat.isLocked && n.seat.assignedStudentId).map(n => n.seat.assignedStudentId);
            const unseatedStudents = activePeriodStudents.value.filter(s => !lockedIds.includes(s.id));

            const preferredPool = shuffleArray(unseatedStudents.filter(s => s.preferredSeating));
            const generalPool = shuffleArray(unseatedStudents.filter(s => !s.preferredSeating));
            const sortedStudents = [...preferredPool, ...generalPool];


            sortedStudents.forEach(student => {
                let bestNode = null; let minimumViolationsFound = 999;

                for (let idx = 0; idx < unlockedSeatNodes.length; idx++) {
                    const node = unlockedSeatNodes[idx];
                    if (node.seat.assignedStudentId) continue; 

                    node.seat.assignedStudentId = student.id;
                    let currentSeatConflicts = 0;

                    allSeatsPool.forEach(otherNode => {
                        if (otherNode === node || !otherNode.seat.assignedStudentId) return;
                        const otherStudent = students.value[otherNode.seat.assignedStudentId];
                        if (!otherStudent) return;

                        const blocksEachOther = student.restrictedStudentIds.includes(otherStudent.id) || 
                                               otherStudent.restrictedStudentIds.includes(student.id);
                        
                        if (blocksEachOther) {
                            let conflictsHere = false;

                            if (node.group === otherNode.group && node.group.furnitureType === 'row') {
                                if (Math.abs(node.seat.seatIndex - otherNode.seat.seatIndex) < 3) conflictsHere = true;
                            }
                            if (node.group === otherNode.group && node.group.furnitureType === 'pod') {
                                const len = node.group.blueprint.length || 3;
                                if (len <= 3) {
                                    conflictsHere = true;
                                } else {
                                    const isOppositeCorner = (Math.abs(node.seat.row - otherNode.seat.row) === 1) && (node.seat.col - otherNode.seat.col === len - 1);
                                    if (!isOppositeCorner) conflictsHere = true;
                                }
                            }
                            const posA = CanvasEngine.getGlobalSeatCenter(node.group, node.seat);
                            const posB = CanvasEngine.getGlobalSeatCenter(otherNode.group, otherNode.seat);
                            if (Math.sqrt(Math.pow(posA.x - posB.x, 2) + Math.pow(posA.y - posB.y, 2)) < minSeparationInches.value) {
                                conflictsHere = true;
                            }

                            if (conflictsHere) currentSeatConflicts++;
                        }
                    });

                    node.seat.assignedStudentId = null;

                    if (currentSeatConflicts < minimumViolationsFound) {
                        minimumViolationsFound = currentSeatConflicts;
                        bestNode = node;
                    }
                    if (minimumViolationsFound === 0) break; 
                }

                if (bestNode) {
                    CanvasEngine.assignStudentToSeatObject(bestNode.group, bestNode.seat, student.id, student.name, false);
                }
            });

            triggerRosterValidation();
        }

        function handleClearAssignments() {
            if (!CanvasEngine.fabricCanvas) return;
            CanvasEngine.fabricCanvas.getObjects().forEach(o => {
                if (o.isFurniture && o.seats) {
                    o.seats.forEach(s => { if (!s.isLocked) CanvasEngine.assignStudentToSeatObject(o, s, null, "Empty Seat", false); });
                }
            });
            triggerRosterValidation();
        }

		// Helper to format inches into Feet & Inches string
		function formatSeparation(totalInches) {
			const feet = Math.floor(totalInches / 12);
			const inches = totalInches % 12;
			return `${feet}' ${inches}"`;
		}

        function handleCreateStudent() {
            if (!newStudentForm.value.name.trim()) return;
            const id = 'std_' + Math.random().toString(36).substr(2, 9).toUpperCase();
            students.value = { ...students.value, [id]: { id, name: newStudentForm.value.name.trim(), gender: newStudentForm.value.gender, preferredSeating: newStudentForm.value.preferredSeating, restrictedStudentIds: [] } };
            newStudentForm.value = { name: '', gender: 'Unspecified', preferredSeating: false };
        }

        function selectStudent(t, s) { 
            if (t === 'A') { 
                searchA.value = s.name; selectedIdA.value = s.id; showDropdownA.value = false; 
            } else { 
                searchB.value = s.name; selectedIdB.value = s.id; showDropdownB.value = false; 
            } 
        }

        function handleDeleteRestriction(idA, idB) { 
            if (students.value[idA]) students.value[idA].restrictedStudentIds = students.value[idA].restrictedStudentIds.filter(id => id !== idB); 
            if (students.value[idB]) students.value[idB].restrictedStudentIds = students.value[idB].restrictedStudentIds.filter(id => id !== idA); 
            students.value = { ...students.value };
            triggerRosterValidation(); 
        }

        function handleDeleteStudent(id) { 
            if (confirm("Delete student?")) { 
                Object.values(students.value).forEach(s => { s.restrictedStudentIds = s.restrictedStudentIds.filter(rId => rId !== id); }); 
                Object.values(periods.value).forEach(p => { p.studentIds = p.studentIds.filter(sId => sId !== id); }); 
                const u = { ...students.value }; delete u[id]; students.value = u; 
                handleClearAssignments(); 
            } 
        }
		
		function handleRemoveStudentFromDesk(studentId) {
            if (!CanvasEngine.fabricCanvas) return;
            CanvasEngine.fabricCanvas.getObjects().forEach(o => {
                if (o.isFurniture && o.seats) {
                    o.seats.forEach(s => {
                        if (s.assignedStudentId === studentId && !s.isLocked) {
                            CanvasEngine.assignStudentToSeatObject(o, s, null, "Empty Seat", false);
                        }
                    });
                }
            });
            triggerRosterValidation();
        }

        function hideDropdownDelayed(t) { setTimeout(() => { if (t === 'A') showDropdownA.value = false; if (t === 'B') showDropdownB.value = false; }, 200); }
        
        function handleCreatePeriod() { 
            if (!newPeriodName.value.trim()) return; 
            const id = 'per_' + Math.random().toString(36).substr(2, 9).toUpperCase(); 
            periods.value = { ...periods.value, [id]: { id, name: newPeriodName.value.trim(), studentIds: [] } }; 
            if (!selectedPeriodId.value) selectedPeriodId.value = id; 
            if (!activeLayoutPeriodId.value) activeLayoutPeriodId.value = id; 
            newPeriodName.value = ''; 
        }
        
        function handleDeletePeriod(id) { 
            if (confirm("Delete period?")) { 
                const u = { ...periods.value }; delete u[id]; periods.value = u; const r = Object.keys(periods.value); 
                selectedPeriodId.value = r.length > 0 ? r[0] : null; activeLayoutPeriodId.value = r.length > 0 ? r[0] : null; 
                localStorage.removeItem('ClassroomSeatingSuite_Assignments_' + id);
                handleLayoutPeriodChange();
            } 
        }
        
        function handleRoomSizeChange() {
            if (roomWidthFeet.value < 10) roomWidthFeet.value = 10; if (roomWidthFeet.value > 60) roomWidthFeet.value = 60;
            if (roomLengthFeet.value < 10) roomLengthFeet.value = 10; if (roomLengthFeet.value > 60) roomLengthFeet.value = 60;
            CanvasEngine.updateRoomSize(roomWidthFeet.value, roomLengthFeet.value);
        }

        function shuttleToRoster(sId) { if (!selectedPeriodId.value || !periods.value[selectedPeriodId.value]) return; if (!periods.value[selectedPeriodId.value].studentIds.includes(sId)) periods.value[selectedPeriodId.value].studentIds.push(sId); }
        function shuttleFromRoster(sId) { if (!selectedPeriodId.value || !periods.value[selectedPeriodId.value]) return; periods.value[selectedPeriodId.value].studentIds = periods.value[selectedPeriodId.value].studentIds.filter(id => id !== sId); handleClearAssignments(); }
        function handleSpawnSingle() { CanvasEngine.spawnSingleDesk(globalDeskWidth.value, globalDeskLength.value); }
        function handleSpawnRow() { CanvasEngine.spawnRow(uiRowCount.value, globalDeskWidth.value, globalDeskLength.value); }
        function handleSpawnPod() { CanvasEngine.spawnPod(uiPodLength.value, globalDeskWidth.value, globalDeskLength.value); }
        function handleSpawnAsset(assetType) { CanvasEngine.spawnAsset(assetType); }
        function handleWipeCanvas() { CanvasEngine.clear(); }
        
        function handleToggleSnap() { isSnapEnabled.value = !isSnapEnabled.value; CanvasEngine.setSnap(isSnapEnabled.value); }
        function handleToggleDeskLock() { isDeskLockEnabled.value = !isDeskLockEnabled.value; CanvasEngine.setDeskLock(isDeskLockEnabled.value); }
        
        function shuffleArray(arr) { return arr.sort(() => Math.random() - 0.5); }
        function handleZoomIn() { CanvasEngine.zoomCanvas(1.25); }
        function handleZoomOut() { CanvasEngine.zoomCanvas(0.8); }
        function handleResetView() { CanvasEngine.recalculateDimensions(); }

        window.addEventListener('canvas-layout-modified', () => { triggerRosterValidation(); });

        onMounted(() => {
            nextTick(() => {
                CanvasEngine.init('classroomCanvas', roomWidthFeet.value * 12, roomLengthFeet.value * 12);
                if (activeLayoutPeriodId.value) {
                    CanvasEngine.loadLayout(activeLayoutPeriodId.value);
                }
                CanvasEngine.setDeskLock(isDeskLockEnabled.value); // Apply saved lock state to loaded desks
                CanvasEngine.recalculateDimensions();
                triggerRosterValidation();
            });
        });

        return {
            currentTab, isSidebarOpen, globalDeskWidth, globalDeskLength, uiRowCount, uiPodLength, isSnapEnabled, isDeskLockEnabled, roomWidthFeet, roomLengthFeet, minSeparationInches, handleRoomSizeChange, updateDeskSizes() {}, students, periods, selectedPeriodId, activeLayoutPeriodId, newStudentForm, newPeriodName, searchA, searchB, selectedIdA, selectedIdB, showDropdownA, showDropdownB, studentCount, periodCount, currentSelectedPeriod, activePeriodStudents, unseatedRosterCount, availableStudentsForPeriod, assignedStudentsForPeriod, filteredA, filteredB, handleCreateStudent, selectStudent, handleApplyRestriction, handleDeleteRestriction, handleDeleteStudent, hideDropdownDelayed, handleCreatePeriod, handleDeletePeriod, shuttleToRoster, shuttleFromRoster, handleSpawnSingle, handleSpawnRow, handleSpawnPod, handleSpawnAsset, handleWipeCanvas, handleToggleSnap, handleToggleDeskLock, handleRosterDragStart, handleCanvasRosterDrop, isStudentSeatedOnCanvas, handleLayoutPeriodChange, handleAutoAssign, handleClearAssignments, triggerRosterValidation, rosterUpdateNonce, editingStudentId, startEdit, saveEdit, exportData, importData, handleResetView, handleZoomIn, handleZoomOut, showInstructionsModal,
			formatSeparation, handleRemoveStudentFromDesk
        };
    }
}).mount('#app');