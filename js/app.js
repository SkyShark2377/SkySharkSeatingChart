const { createApp, ref, computed, watch, nextTick, onMounted } = Vue;

createApp({
    setup() {
        const currentTab = ref('layout');
        const isSidebarOpen = ref(true);
        const isRightSidebarOpen = ref(true);
        const rosterUpdateNonce = ref(0); 
        const showInstructionsModal = ref(false);
        const STORAGE_KEY = 'ClassroomSeatingSuite_LocalPersistence_v1';

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

        if (!restoredState.periods['period_homeroom_base']) {
            restoredState.periods['period_homeroom_base'] = {
                id: 'period_homeroom_base', name: 'Homeroom Base', studentIds: []
            };
        }

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
        const genderDistributionMode = ref(restoredState.genderDistributionMode || 'random');

        const periodKeysList = Object.keys(periods.value);
        const activeLayoutPeriodId = ref(restoredState.activePeriodId || (periodKeysList.length > 0 ? periodKeysList[0] : null));   
        const selectedPeriodId = ref(restoredState.activePeriodId || (periodKeysList.length > 0 ? periodKeysList[0] : null));   

        const newStudentForm = ref({ name: '', gender: 'Unspecified', preferredSeating: false });
        const newPeriodName = ref('');
        const editingStudentId = ref(null);
        const searchA = ref(''); const searchB = ref('');
        const selectedIdA = ref(null); const selectedIdB = ref(null);
        const showDropdownA = ref(false); const showDropdownB = ref(false);

        // BRIDGE: Now handles Delete warning checks for Homeroom Anchors
        window.VueAppBridge = {
            lookupStudent(id) { return students.value[id] || null; },
            getActivePeriodId() { return activeLayoutPeriodId.value; },
            incrementNonce() { rosterUpdateNonce.value++; },
            checkFurnitureForAnchors(fabricGroup) {
                if (!fabricGroup.seats) return false;
                let hasAnchor = false;
                fabricGroup.seats.forEach(s => {
                    const seatKey = fabricGroup.furnitureId + '_' + s.seatIndex;
                    if (Object.values(students.value).some(student => student.ownedSeatKey === seatKey)) {
                        hasAnchor = true;
                    }
                });
                return hasAnchor;
            },
            clearAnchorsForFurniture(fabricGroup) {
                if (!fabricGroup.seats) return;
                let changed = false;
                fabricGroup.seats.forEach(s => {
                    const seatKey = fabricGroup.furnitureId + '_' + s.seatIndex;
                    Object.values(students.value).forEach(student => {
                        if (student.ownedSeatKey === seatKey) {
                            student.ownedSeatKey = null;
                            changed = true;
                        }
                    });
                });
                if (changed) students.value = { ...students.value };
            }
        };

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
            rosterUpdateNonce.value; 
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

        watch(() => ({
            students: students.value, periods: periods.value, roomWidthFeet: roomWidthFeet.value, roomLengthFeet: roomLengthFeet.value, globalDeskWidth: globalDeskWidth.value, globalDeskLength: globalDeskLength.value, minSeparationInches: minSeparationInches.value, activePeriodId: activeLayoutPeriodId.value, isDeskLockEnabled: isDeskLockEnabled.value, genderDistributionMode: genderDistributionMode.value
        }), (snapshot) => { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); }, { deep: true });

        function isStudentSeatedOnCanvas(studentId) {
            rosterUpdateNonce.value; 
            if (!CanvasEngine.fabricCanvas) return false;
            return CanvasEngine.fabricCanvas.getObjects().some(o => o.isFurniture && o.seats && o.seats.some(s => s.assignedStudentId === studentId));
        }

        function isHomeroomStudent(studentId) {
            const hrPeriod = periods.value['period_homeroom_base'];
            return hrPeriod && (hrPeriod.studentIds || []).includes(studentId);
        }

        // NEW: Handles clicking "Anchor Current Seats"
        function handleSetHomeroomAnchors() {
            if (!CanvasEngine.fabricCanvas) return;
            if (activeLayoutPeriodId.value !== 'period_homeroom_base') {
                alert("You can only set Homeroom Anchors from the Homeroom Base period.");
                return;
            }

            let count = 0;
            CanvasEngine.fabricCanvas.getObjects().forEach(o => {
                if (o.isFurniture && o.seats) {
                    o.seats.forEach(s => {
                        if (s.assignedStudentId) {
                            const student = students.value[s.assignedStudentId];
                            if (student) {
                                student.ownedSeatKey = o.furnitureId + '_' + s.seatIndex;
                                count++;
                            }
                        }
                    });
                }
            });
            students.value = { ...students.value };
            triggerRosterValidation();
            alert(`Anchored ${count} students to their current desks.`);

            // Force a re-render to make the 🏠 icons instantly appear
            CanvasEngine.fabricCanvas.getObjects().forEach(o => {
                if (o.isFurniture && o.seats) {
                    o.seats.forEach(s => {
                        if (s.assignedStudentId) CanvasEngine.assignStudentToSeatObject(o, s, s.assignedStudentId, students.value[s.assignedStudentId], s.isLocked);
                    });
                }
            });
        }

        // NEW: Handles clearing the anchors
        function handleClearHomeroomAnchors() {
            if (confirm("Clear all homeroom desk anchors?")) {
                Object.values(students.value).forEach(s => {
                    s.ownedSeatKey = null;
                });
                students.value = { ...students.value };
                triggerRosterValidation();
                
                CanvasEngine.fabricCanvas.getObjects().forEach(o => {
                    if (o.isFurniture && o.seats) {
                        o.seats.forEach(s => {
                            if (s.assignedStudentId) CanvasEngine.assignStudentToSeatObject(o, s, s.assignedStudentId, students.value[s.assignedStudentId], s.isLocked);
                        });
                    }
                });
            }
        }

        function startEdit(s) { editingStudentId.value = s.id; }
        function saveEdit() { editingStudentId.value = null; CanvasEngine.loadLayout(activeLayoutPeriodId.value); }

        function triggerRosterValidation() {
            CanvasEngine.validateSeatingLayout(students.value, minSeparationInches.value);
            rosterUpdateNonce.value++;
        }

        function handleRosterDragStart(event, studentId) { event.dataTransfer.setData('text/plain', studentId); }

        function handleCanvasRosterDrop(event) {
            event.preventDefault();
            const studentId = event.dataTransfer ? event.dataTransfer.getData('text/plain') : '';
            if (!studentId || !students.value[studentId]) return;

            const pointer = CanvasEngine.fabricCanvas.getPointer(event);
            let closestNode = null; let minDistance = 999999; 

            const furnitureObjects = CanvasEngine.fabricCanvas.getObjects().filter(o => o.isFurniture);
            furnitureObjects.forEach(group => {
                if (group.seats) {
                    group.seats.forEach(seat => {
                        const globalCenter = CanvasEngine.getGlobalSeatCenter(group, seat);
                        const distance = Math.sqrt(Math.pow(globalCenter.x - pointer.x, 2) + Math.pow(globalCenter.y - pointer.y, 2));
                        if (distance < minDistance) { minDistance = distance; closestNode = { group, seat }; }
                    });
                }
            });

            if (closestNode && minDistance <= 40) {
                const { group, seat } = closestNode;
                if (seat.isLocked) { alert("This seat is locked. Double-click it to unlock it before changing students."); return; }
                
                // NEW: Squatter Interception Check
                const targetSeatKey = group.furnitureId + '_' + seat.seatIndex;
                const owner = Object.values(students.value).find(s => s.ownedSeatKey === targetSeatKey && s.id !== studentId);
                
                if (owner) {
                    if (!confirm(`This desk belongs to ${owner.name}'s homeroom. Are you sure you want to seat ${students.value[studentId].name} here?`)) {
                        return;
                    }
                }

                CanvasEngine.assignStudentToSeatObject(group, seat, studentId, students.value[studentId], false);
                triggerRosterValidation();
            }
        }

        function exportData() {
            const vueStateData = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            const canvasLayoutData = JSON.parse(localStorage.getItem('ClassroomSeatingSuite_CanvasLayout_v1') || '[]');
            const assignmentsData = {};
            if (vueStateData.periods) {
                Object.keys(vueStateData.periods).forEach(periodId => {
                    const assignData = localStorage.getItem('ClassroomSeatingSuite_Assignments_' + periodId);
                    if (assignData) assignmentsData[periodId] = JSON.parse(assignData);
                });
            }
            const dataStr = JSON.stringify({ version: "2.0", vueState: vueStateData, canvasLayout: canvasLayoutData, assignments: assignmentsData }, null, 2); 
            const linkElement = document.createElement('a');
            linkElement.setAttribute('href', 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr));
            linkElement.setAttribute('download', 'ClassroomSeatingData.json');
            linkElement.click();
        }

        function importData(event) {
            const file = event.target.files ? event.target.files[0] : null;
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const importedData = JSON.parse(e.target.result);
                    if (importedData.vueState) localStorage.setItem(STORAGE_KEY, JSON.stringify(importedData.vueState));
                    if (importedData.canvasLayout) localStorage.setItem('ClassroomSeatingSuite_CanvasLayout_v1', JSON.stringify(importedData.canvasLayout));
                    if (importedData.assignments) {
                        Object.keys(importedData.assignments).forEach(periodId => {
                            localStorage.setItem('ClassroomSeatingSuite_Assignments_' + periodId, JSON.stringify(importedData.assignments[periodId]));
                        });
                    }
                    alert("Data imported successfully! The application will now reload.");
                    window.location.reload();
                } catch (err) { alert("Invalid file format. Please ensure you are importing a valid Classroom Seating Data JSON file."); }
            };
            reader.readAsText(file);
        }

        function handleApplyRestriction() {
            const idA = selectedIdA.value; const idB = selectedIdB.value;
            if (!idA || !idB || idA === idB || !students.value[idA] || !students.value[idB]) return;

            if (!students.value[idA].restrictedStudentIds) students.value[idA].restrictedStudentIds = [];
            if (!students.value[idB].restrictedStudentIds) students.value[idB].restrictedStudentIds = [];

            if (!students.value[idA].restrictedStudentIds.includes(idB)) students.value[idA].restrictedStudentIds.push(idB);
            if (!students.value[idB].restrictedStudentIds.includes(idA)) students.value[idB].restrictedStudentIds.push(idA);

            searchA.value = ''; searchB.value = ''; selectedIdA.value = null; selectedIdB.value = null;
            students.value = { ...students.value };
            triggerRosterValidation();
        }

        function handleLayoutPeriodChange() {
            if (!activeLayoutPeriodId.value || activeLayoutPeriodId.value === 'null') return;
            selectedPeriodId.value = activeLayoutPeriodId.value; 
            CanvasEngine.loadLayout(activeLayoutPeriodId.value);
            triggerRosterValidation();
        }

        function applyGenderSort(pool, mode) {
            if (mode === 'random') return shuffleArray(pool);
            const boys = shuffleArray(pool.filter(s => s.gender === 'Male'));
            const girls = shuffleArray(pool.filter(s => s.gender === 'Female'));
            const unspec = shuffleArray(pool.filter(s => s.gender === 'Unspecified'));

            if (mode === 'clustered') return Math.random() > 0.5 ? [...boys, ...girls, ...unspec] : [...girls, ...boys, ...unspec];
            
            if (mode === 'alternating') {
                const result = []; const maxLen = Math.max(boys.length, girls.length);
                const boysFirst = Math.random() > 0.5; 
                for (let i = 0; i < maxLen; i++) {
                    if (boysFirst) { if (boys[i]) result.push(boys[i]); if (girls[i]) result.push(girls[i]); } 
                    else { if (girls[i]) result.push(girls[i]); if (boys[i]) result.push(boys[i]); }
                }
                return [...result, ...unspec];
            }
            return pool;
        }

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
                if (Math.abs(posA.y - posB.y) < 24) return posA.x - posB.x;
                return posA.y - posB.y;
            });

            // 1. Clears desks safely before running algorithm
            unlockedSeatNodes.forEach(n => {
                CanvasEngine.assignStudentToSeatObject(n.group, n.seat, null, null, false);
            });

            const lockedIds = allSeatsPool.filter(n => n.seat.isLocked && n.seat.assignedStudentId).map(n => n.seat.assignedStudentId);
            const unseatedStudents = activePeriodStudents.value.filter(s => !lockedIds.includes(s.id));

            // 2. NEW: The Pre-Seat Anchor Protocol
            const anchoredPlacedIds = [];
            unseatedStudents.forEach(student => {
                if (student.ownedSeatKey) {
                    const targetNode = unlockedSeatNodes.find(n => (n.group.furnitureId + '_' + n.seat.seatIndex) === student.ownedSeatKey);
                    // If we found the physical desk and nobody squatted in it, snap them in!
                    if (targetNode && !targetNode.seat.assignedStudentId) {
                        CanvasEngine.assignStudentToSeatObject(targetNode.group, targetNode.seat, student.id, student, false);
                        anchoredPlacedIds.push(student.id);
                    }
                }
            });

            // 3. Continue with remaining pool
            const remainingUnseated = unseatedStudents.filter(s => !anchoredPlacedIds.includes(s.id));
            const stillUnlockedNodes = unlockedSeatNodes.filter(n => !n.seat.assignedStudentId);

            const preferredPool = applyGenderSort(remainingUnseated.filter(s => s.preferredSeating), genderDistributionMode.value);
            const generalPool = applyGenderSort(remainingUnseated.filter(s => !s.preferredSeating), genderDistributionMode.value);
            const sortedStudents = [...preferredPool, ...generalPool];

            sortedStudents.forEach(student => {
                let bestNode = null; let minimumViolationsFound = 999;

                for (let idx = 0; idx < stillUnlockedNodes.length; idx++) {
                    const node = stillUnlockedNodes[idx];
                    if (node.seat.assignedStudentId) continue; 

                    node.seat.assignedStudentId = student.id;
                    let currentSeatConflicts = 0;

                    allSeatsPool.forEach(otherNode => {
                        if (otherNode === node || !otherNode.seat.assignedStudentId) return;
                        const otherStudent = students.value[otherNode.seat.assignedStudentId];
                        if (!otherStudent) return;

                        const safeStudentRestricted = student.restrictedStudentIds || [];
                        const safeOtherRestricted = otherStudent.restrictedStudentIds || [];

                        const blocksEachOther = safeStudentRestricted.includes(otherStudent.id) || safeOtherRestricted.includes(student.id);
                        
                        if (blocksEachOther) {
                            let conflictsHere = false;
                            if (node.group === otherNode.group && node.group.furnitureType === 'row') {
                                if (Math.abs(node.seat.seatIndex - otherNode.seat.seatIndex) < 3) conflictsHere = true;
                            }
                            if (node.group === otherNode.group && node.group.furnitureType === 'pod') {
                                const len = node.group.blueprint.length || 3;
                                if (len <= 3) conflictsHere = true;
                                else {
                                    const isOppositeCorner = (Math.abs(node.seat.row - otherNode.seat.row) === 1) && (node.seat.col - otherNode.seat.col === len - 1);
                                    if (!isOppositeCorner) conflictsHere = true;
                                }
                            }
                            const posA = CanvasEngine.getGlobalSeatCenter(node.group, node.seat);
                            const posB = CanvasEngine.getGlobalSeatCenter(otherNode.group, otherNode.seat);
                            if (Math.sqrt(Math.pow(posA.x - posB.x, 2) + Math.pow(posA.y - posB.y, 2)) < minSeparationInches.value) conflictsHere = true;
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

                if (bestNode) { CanvasEngine.assignStudentToSeatObject(bestNode.group, bestNode.seat, student.id, student, false); }
            });

            triggerRosterValidation();
        }

        function handleClearAssignments() {
            if (!CanvasEngine.fabricCanvas) return;
            CanvasEngine.fabricCanvas.getObjects().forEach(o => {
                if (o.isFurniture && o.seats) {
                    o.seats.forEach(s => { if (!s.isLocked) CanvasEngine.assignStudentToSeatObject(o, s, null, null, false); });
                }
            });
            triggerRosterValidation();
        }

        function formatSeparation(totalInches) { return `${Math.floor(totalInches / 12)}' ${totalInches % 12}"`; }

        function handleCreateStudent() {
            if (!newStudentForm.value.name.trim()) return;
            const id = 'std_' + Math.random().toString(36).substr(2, 9).toUpperCase();
            // NEW: Adding ownedSeatKey string to profile
            students.value = { ...students.value, [id]: { id, name: newStudentForm.value.name.trim(), gender: newStudentForm.value.gender, preferredSeating: newStudentForm.value.preferredSeating, restrictedStudentIds: [], ownedSeatKey: null } };
            newStudentForm.value = { name: '', gender: 'Unspecified', preferredSeating: false };
        }

        function handleRosterUpload(event) {
            const file = event.target.files ? event.target.files[0] : null;
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                const text = e.target.result;
                const lines = text.split(/\r?\n/); 
                let importedCount = 0; let updatedCount = 0;

                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue; 

                    const cols = line.split(',');
                    const name = cols[0] ? cols[0].trim() : '';
                    if (!name) continue; 

                    let gender = 'Unspecified';
                    if (cols[1]) {
                        const g = cols[1].trim().toLowerCase();
                        if (g === 'm' || g === 'male' || g === 'boy' || g === 'b') gender = 'Male';
                        else if (g === 'f' || g === 'female' || g === 'girl' || g === 'g') gender = 'Female';
                    }

                    const p = cols[2] ? cols[2].trim().toLowerCase() : '';
                    const preferredSeating = (p === 'true' || p === 'yes' || p === 'y' || p === '1');
                    const existingStudent = Object.values(students.value).find(s => s.name.toLowerCase() === name.toLowerCase());

                    if (existingStudent) {
                        existingStudent.gender = gender; existingStudent.preferredSeating = preferredSeating; updatedCount++;
                    } else {
                        const id = 'std_' + Math.random().toString(36).substr(2, 9).toUpperCase();
                        students.value[id] = { id, name, gender, preferredSeating, restrictedStudentIds: [], ownedSeatKey: null };
                        importedCount++;
                    }
                }
                students.value = { ...students.value };
                alert(`Roster Processed!\nAdded ${importedCount} new students.\nUpdated ${updatedCount} existing students.`);
            };
            reader.readAsText(file);
            event.target.value = ''; 
        }

        function selectStudent(t, s) { 
            if (t === 'A') { searchA.value = s.name; selectedIdA.value = s.id; showDropdownA.value = false; } 
            else { searchB.value = s.name; selectedIdB.value = s.id; showDropdownB.value = false; } 
        }

        function handleDeleteRestriction(idA, idB) { 
            if (students.value[idA] && students.value[idA].restrictedStudentIds) students.value[idA].restrictedStudentIds = students.value[idA].restrictedStudentIds.filter(id => id !== idB); 
            if (students.value[idB] && students.value[idB].restrictedStudentIds) students.value[idB].restrictedStudentIds = students.value[idB].restrictedStudentIds.filter(id => id !== idA); 
            students.value = { ...students.value }; triggerRosterValidation(); 
        }

        function handleDeleteStudent(id) { 
            if (confirm("Delete student?")) { 
                Object.values(students.value).forEach(s => { 
                    if (s.restrictedStudentIds) s.restrictedStudentIds = s.restrictedStudentIds.filter(rId => rId !== id); 
                }); 
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
                        if (s.assignedStudentId === studentId && !s.isLocked) CanvasEngine.assignStudentToSeatObject(o, s, null, null, false);
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
        
        function handleRenamePeriod(id) {
            const currentName = periods.value[id].name;
            const newName = prompt("Enter a new name for this class period:", currentName);
            if (newName && newName.trim() !== "") periods.value[id].name = newName.trim();
        }

        function handleDeletePeriod(id) { 
            if (id === 'period_homeroom_base') { alert("The Homeroom Base period cannot be deleted."); return; }
            if (confirm("Delete period?")) { 
                const u = { ...periods.value }; delete u[id]; periods.value = u; const r = Object.keys(periods.value); 
                selectedPeriodId.value = r.length > 0 ? r[0] : null; activeLayoutPeriodId.value = r.length > 0 ? r[0] : null; 
                localStorage.removeItem('ClassroomSeatingSuite_Assignments_' + id); handleLayoutPeriodChange();
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
                if (activeLayoutPeriodId.value) CanvasEngine.loadLayout(activeLayoutPeriodId.value);
                CanvasEngine.setDeskLock(isDeskLockEnabled.value); 
                CanvasEngine.recalculateDimensions();
                triggerRosterValidation();
            });
        });

        return {
            currentTab, isSidebarOpen, isRightSidebarOpen, globalDeskWidth, globalDeskLength, uiRowCount, uiPodLength, isSnapEnabled, isDeskLockEnabled, roomWidthFeet, roomLengthFeet, minSeparationInches, handleRoomSizeChange, updateDeskSizes() {}, students, periods, selectedPeriodId, activeLayoutPeriodId, newStudentForm, newPeriodName, searchA, searchB, selectedIdA, selectedIdB, showDropdownA, showDropdownB, studentCount, periodCount, currentSelectedPeriod, activePeriodStudents, unseatedRosterCount, availableStudentsForPeriod, assignedStudentsForPeriod, filteredA, filteredB, handleCreateStudent, selectStudent, handleApplyRestriction, handleDeleteRestriction, handleDeleteStudent, hideDropdownDelayed, handleCreatePeriod, handleDeletePeriod, shuttleToRoster, shuttleFromRoster, handleSpawnSingle, handleSpawnRow, handleSpawnPod, handleSpawnAsset, handleWipeCanvas, handleToggleSnap, handleToggleDeskLock, handleRosterDragStart, handleCanvasRosterDrop, isStudentSeatedOnCanvas, handleLayoutPeriodChange, handleAutoAssign, handleClearAssignments, triggerRosterValidation, rosterUpdateNonce, editingStudentId, startEdit, saveEdit, exportData, importData, handleResetView, handleZoomIn, handleZoomOut, showInstructionsModal, formatSeparation, handleRemoveStudentFromDesk, handleRosterUpload, genderDistributionMode, isHomeroomStudent, handleRenamePeriod, handleSetHomeroomAnchors, handleClearHomeroomAnchors 
        };
    }
}).mount('#app');