import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const STORAGE_KEY = 'storyverse-progress-v1';
const EDITOR_KEY = 'storyverse-editor-v1';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const stageEl = $('#sceneStage');
const toastEl = $('#toast');
let baseData = null;
let storyData = null;
let activeStory = null;
let activeScene = 0;
let scanner = null;
let qrScannerRunning = false;
let toastTimer = null;
let narrationUtterance = null;
let musicContext = null;
let musicNodes = [];
let musicOn = false;
let threeExperience = null;
let quizState = null;
let currentProgress = readProgress();
let cloudSupabase = null;
let cloudStudentId = null;
let cloudClassId = null;

function readProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { name: '', scenes: {}, completed: [], results: [] };
  } catch {
    return { name: '', scenes: {}, completed: [], results: [] };
  }
}
function saveProgress() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(currentProgress)); }
  catch { showToast('This browser could not save progress.'); }
}
function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
}
function openModal(id) {
  const modal = document.getElementById(id);
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}
function closeModal(id) {
  const modal = document.getElementById(id);
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  if (!$('.modal-shell.open')) document.body.classList.remove('modal-open');
}
function stopNarration() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  narrationUtterance = null;
  $('#narrationToggle').textContent = '▶';
  $('#audioStatus').textContent = 'Narration is ready';
}
function speakText(text, status = 'Playing narration') {
  if (!('speechSynthesis' in window)) {
    showToast('Speech narration is not available in this browser.');
    return;
  }
  window.speechSynthesis.cancel();
  narrationUtterance = new SpeechSynthesisUtterance(text);
  narrationUtterance.lang = 'en-US';
  narrationUtterance.rate = Number($('#speechRate').value || 1);
  narrationUtterance.pitch = 1.02;
  narrationUtterance.volume = 0.92;
  const voices = window.speechSynthesis.getVoices();
  const englishVoice = voices.find(v => /^en(-|_)/i.test(v.lang) && /natural|samantha|google|aria|jenny/i.test(v.name)) || voices.find(v => /^en(-|_)/i.test(v.lang));
  if (englishVoice) narrationUtterance.voice = englishVoice;
  narrationUtterance.onend = () => {
    $('#narrationToggle').textContent = '▶';
    $('#audioStatus').textContent = 'Narration finished';
  };
  narrationUtterance.onerror = () => {
    $('#narrationToggle').textContent = '▶';
    $('#audioStatus').textContent = 'Narration unavailable';
  };
  $('#narrationToggle').textContent = 'Ⅱ';
  $('#audioStatus').textContent = status;
  window.speechSynthesis.speak(narrationUtterance);
}
function toggleNarration() {
  if (!('speechSynthesis' in window)) return showToast('Speech narration is not available here.');
  if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
    window.speechSynthesis.pause();
    $('#narrationToggle').textContent = '▶';
    $('#audioStatus').textContent = 'Narration paused';
  } else if (window.speechSynthesis.paused) {
    window.speechSynthesis.resume();
    $('#narrationToggle').textContent = 'Ⅱ';
    $('#audioStatus').textContent = 'Playing narration';
  } else if (activeStory) {
    speakText(activeStory.scenes[activeScene].narration || activeStory.scenes[activeScene].text);
  }
}
function startMusic() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return showToast('Ambient audio is not supported by this browser.');
  if (!musicContext) {
    musicContext = new AudioCtx();
    const master = musicContext.createGain();
    master.gain.value = 0.035;
    master.connect(musicContext.destination);
    musicNodes.push(master);

    // A soft procedural soundscape: generated locally, with no external audio files.
    // Forest = wind + bird-like calls; ocean = bubbles + low surf; web = gentle woodland rustle.
    const world = activeStory?.world || 'web';
    const bufferSize = 2 * musicContext.sampleRate;
    const noiseBuffer = musicContext.createBuffer(1, bufferSize, musicContext.sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) channel[i] = (Math.random() * 2 - 1) * 0.22;
    const noise = musicContext.createBufferSource();
    noise.buffer = noiseBuffer; noise.loop = true;
    const filter = musicContext.createBiquadFilter();
    filter.type = world === 'ocean' ? 'lowpass' : 'bandpass';
    filter.frequency.value = world === 'ocean' ? 420 : world === 'forest' ? 850 : 520;
    filter.Q.value = 0.55;
    const wind = musicContext.createGain(); wind.gain.value = world === 'ocean' ? 0.42 : 0.2;
    noise.connect(filter); filter.connect(wind); wind.connect(master); noise.start();
    musicNodes.push(noise, filter, wind);

    const addTone = (hz, type, volume, detune=0) => {
      const osc=musicContext.createOscillator(), gain=musicContext.createGain();
      osc.type=type; osc.frequency.value=hz; osc.detune.value=detune; gain.gain.value=volume;
      osc.connect(gain); gain.connect(master); osc.start(); musicNodes.push(osc,gain);
    };
    if (world === 'ocean') {
      addTone(82,'sine',0.22); addTone(164.8,'sine',0.08);
      addTone(392,'sine',0.025,9); // distant, soft water shimmer
      const bubble=musicContext.createOscillator(), bubbleGain=musicContext.createGain();
      const bubblePulse=musicContext.createOscillator(), bubbleDepth=musicContext.createGain();
      bubble.type='sine'; bubble.frequency.value=520; bubbleGain.gain.value=0.0025;
      bubblePulse.frequency.value=0.8; bubbleDepth.gain.value=0.002;
      bubblePulse.connect(bubbleDepth); bubbleDepth.connect(bubbleGain.gain); bubble.connect(bubbleGain); bubbleGain.connect(master);
      bubble.start(); bubblePulse.start(); musicNodes.push(bubble,bubbleGain,bubblePulse,bubbleDepth);
    } else if (world === 'forest') {
      addTone(196,'sine',0.12); addTone(293.66,'sine',0.07);
      // Gentle synthesized bird chirp: softly pulsing high notes, not a recording.
      const bird=musicContext.createOscillator(), birdGain=musicContext.createGain();
      const flutter=musicContext.createOscillator(), flutterGain=musicContext.createGain();
      bird.type='sine'; bird.frequency.value=1450; birdGain.gain.value=0.006;
      flutter.type='sine'; flutter.frequency.value=3.2; flutterGain.gain.value=0.004;
      flutter.connect(flutterGain); flutterGain.connect(birdGain.gain); bird.connect(birdGain); birdGain.connect(master);
      bird.start(); flutter.start(); musicNodes.push(bird,birdGain,flutter,flutterGain);
    } else {
      addTone(130.81,'triangle',0.12); addTone(196,'sine',0.07); addTone(261.63,'triangle',0.04);
    }
  }
  musicContext.resume();
  musicOn = true;
  $('#musicToggle').textContent = '♫ ON';
  $('#musicToggle').setAttribute('aria-label', 'Turn story ambience off');
}
function stopMusic() {
  if (musicContext) musicContext.suspend();
  musicOn = false;
  $('#musicToggle').textContent = '♫';
  $('#musicToggle').setAttribute('aria-label', 'Turn story ambience on');
}
function toggleMusic() { musicOn ? stopMusic() : startMusic(); }

// Optional cloud classroom link. The public story library still works without Supabase.
// A class-linked story only syncs after the signed-in learner is verified as a member.
async function initializeCloudClass(classId, storyId) {
  try {
    const module = await import('./supabase-client.js');
    if (!module.supabaseConfigured || !module.supabase) {
      showToast('Classroom sync is not configured yet. Ask your teacher to finish the Supabase setup.');
      window.location.href = './student.html';
      return false;
    }
    cloudSupabase = module.supabase;
    const { data: sessionResult, error: sessionError } = await cloudSupabase.auth.getSession();
    if (sessionError) throw sessionError;
    const user = sessionResult?.session?.user;
    if (!user) {
      showToast('Please log in to your student account to open this assigned story.');
      window.location.href = './student.html';
      return false;
    }
    const { data: profile, error: profileError } = await cloudSupabase
      .from('profiles').select('id,role').eq('id', user.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.role !== 'student') {
      showToast('This assigned-story link is for a student account.');
      window.location.href = './student.html';
      return false;
    }
    const { data: membership, error: membershipError } = await cloudSupabase
      .from('class_members').select('class_id').eq('class_id', classId).eq('student_id', user.id).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) {
      showToast('You are not a member of this class. Join with the code from your teacher first.');
      window.location.href = './student.html';
      return false;
    }
    if (storyId) {
      const { data: assignment, error: assignmentError } = await cloudSupabase
        .from('story_assignments').select('story_id').eq('class_id', classId).eq('story_id', storyId).maybeSingle();
      if (assignmentError) throw assignmentError;
      if (!assignment) {
        showToast('This story is not assigned to your classroom yet.');
        window.location.href = './student.html';
        return false;
      }
    }
    cloudStudentId = user.id;
    cloudClassId = classId;
    return true;
  } catch (error) {
    console.error('STORYVERSE class verification failed:', error);
    showToast('Could not verify classroom access. Please return to Classroom Login and try again.');
    window.location.href = './student.html';
    return false;
  }
}

async function syncCloudSceneProgress(scenesCompleted) {
  if (!cloudSupabase || !cloudStudentId || !cloudClassId || !activeStory) return;
  const { error } = await cloudSupabase.rpc('record_storyverse_scene_progress', {
    p_class_id: cloudClassId,
    p_story_id: activeStory.id,
    p_scenes_completed: Math.max(1, Math.min(3, scenesCompleted)),
  });
  if (error) {
    console.error('Could not sync scene progress:', error);
    showToast('Saved on this device, but classroom progress did not sync. Check your connection.');
  }
}


async function loadStories() {
  const response = await fetch('./data/stories.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error('Could not load story content.');
  baseData = await response.json();
  const savedEditor = localStorage.getItem(EDITOR_KEY);
  if (savedEditor) {
    try { storyData = JSON.parse(savedEditor); }
    catch { storyData = structuredClone(baseData); }
  } else storyData = structuredClone(baseData);
  validateStoryData(storyData);
  renderStoryLibrary();
  renderProgress();
  const params = new URLSearchParams(location.search);
  const storyId = params.get('story');
  const classId = params.get('class');
  if (classId) {
    const verified = await initializeCloudClass(classId, storyId);
    if (!verified) return;
  }
  if (storyId && findStory(storyId)) setTimeout(() => openStory(storyId), 500);
}
function validateStoryData(data) {
  if (!data || !Array.isArray(data.stories) || data.stories.length < 1) throw new Error('Story JSON must contain a stories array.');
  for (const story of data.stories) {
    if (!story.id || !story.title || !Array.isArray(story.scenes) || story.scenes.length !== 3 || !Array.isArray(story.quiz)) {
      throw new Error(`Story "${story.title || 'unnamed'}" must have an id, title, exactly 3 scenes, and quiz questions.`);
    }
    for (const scene of story.scenes) if (!scene.title || !scene.text) throw new Error(`A scene in "${story.title}" is missing a title or text.`);
    for (const question of story.quiz) {
      if (!question.question || !Array.isArray(question.choices) || question.choices.length < 2) throw new Error(`A quiz question in "${story.title}" is incomplete.`);
    }
  }
}
function findStory(id) { return storyData?.stories.find(story => story.id === id); }
function makeStoryUrl(id) {
  const url = new URL(location.href);
  url.searchParams.set('story', id);
  url.hash = '';
  return url.href;
}
function renderStoryLibrary() {
  const grid = $('#storyGrid');
  $('#storyCount').textContent = String(storyData.stories.length).padStart(2, '0');
  grid.innerHTML = storyData.stories.map(story => {
    const symbol = story.world === 'web' ? '🕷️' : story.world === 'forest' ? '🌲' : '🐢';
    return `<article class="story-card" data-story-card="${escapeHtml(story.id)}">
      <div class="story-cover">
        <div class="cover-art"><span class="cover-title-mark">STORYVERSE · ${escapeHtml(story.genre || 'STORY')}</span><span class="cover-orbit"></span><span class="cover-spark s1">✦</span><span class="cover-spark s2">✧</span><span class="cover-spark s3">✦</span><span class="cover-subject">${symbol}</span></div>
      </div>
      <div class="story-meta"><div class="story-tags"><span>${escapeHtml(story.genre || 'STORY')}</span><span class="scene-count">03 SCENES</span></div><h3>${escapeHtml(story.title)}</h3><p>${escapeHtml(story.description)}</p><div class="story-card-actions"><button class="open-story" data-open-story="${escapeHtml(story.id)}">OPEN STORY ↗</button><button class="qr-button" data-toggle-qr="${escapeHtml(story.id)}" aria-label="Show QR code for ${escapeHtml(story.title)}">⌗</button></div></div>
      <div class="qr-card" id="qr-${escapeHtml(story.id)}"><div class="qr-render" id="qr-render-${escapeHtml(story.id)}"></div><div class="qr-explain"><b>${escapeHtml(story.title)} · STORY QR</b>Scan this unique code to open this story on the published site.<br/><a href="#" class="print-qr" data-print-qr="${escapeHtml(story.id)}">Print this code ↗</a></div></div>
    </article>`;
  }).join('');
  $$('[data-open-story]', grid).forEach(button => button.addEventListener('click', () => openStory(button.dataset.openStory)));
  $$('[data-toggle-qr]', grid).forEach(button => button.addEventListener('click', () => toggleQr(button.dataset.toggleQr)));
  $$('[data-print-qr]', grid).forEach(link => link.addEventListener('click', event => { event.preventDefault(); window.print(); }));
  storyData.stories.forEach(story => makeQr(story));
}
function makeQr(story) {
  const holder = document.getElementById(`qr-render-${story.id}`);
  if (!holder) return;
  holder.innerHTML = '';
  const value = makeStoryUrl(story.id);
  if (window.QRCode) {
    new QRCode(holder, { text: value, width: 76, height: 76, colorDark: '#17122f', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
  } else {
    holder.textContent = 'QR library unavailable';
    holder.style.fontSize = '7px';
    holder.style.color = '#17122f';
    holder.style.textAlign = 'center';
  }
}
function toggleQr(id) {
  const card = document.getElementById(`qr-${id}`);
  const wasOpen = card.classList.contains('show');
  $$('.qr-card').forEach(el => el.classList.remove('show'));
  if (!wasOpen) card.classList.add('show');
}

function openStory(id) {
  const story = findStory(id);
  if (!story) return showToast('That story code was not recognized.');
  activeStory = story;
  activeScene = 0;
  stopNarration();
  stopMusic();
  $('#storyTitle').textContent = story.title;
  renderScene();
  openModal('storyModal');
}
function renderScene() {
  if (!activeStory) return;
  const scene = activeStory.scenes[activeScene];
  $('#sceneCounter').textContent = `SCENE ${activeScene + 1} OF ${activeStory.scenes.length}`;
  $('#sceneLabel').textContent = scene.label || `SCENE ${activeScene + 1}`;
  $('#sceneHeading').textContent = scene.title;
  $('#storyCopy').textContent = scene.text;
  $('#sceneProgressText').textContent = `${Math.min(activeScene, Number(currentProgress.scenes[activeStory.id] || 0))} / 3 scenes completed`;
  $('#sceneProgressBar').style.width = `${Math.min(100, Number(currentProgress.scenes[activeStory.id] || 0) / 3 * 100)}%`;
  $('#nextScene').innerHTML = activeScene === 2 ? 'FINISH & TAKE QUIZ <span>→</span>' : 'NEXT SCENE <span>→</span>';
  $('#audioStatus').textContent = 'Narration is ready';
  $('#narrationToggle').textContent = '▶';
  const words = scene.vocabulary || [];
  $('#wordHelp').innerHTML = words.map(item => `<button class="vocab-chip" data-word="${escapeHtml(item.word)}" title="${escapeHtml(item.meaning)}"><b>${escapeHtml(item.word)}</b> · ${escapeHtml(item.meaning)}</button>`).join('');
  $$('[data-word]').forEach(button => button.addEventListener('click', () => {
    showToast(`${button.dataset.word}: ${button.title}`);
    speakText(button.dataset.word, `Pronouncing “${button.dataset.word}”`);
  }));
  disposeThree();
  buildThreeScene(activeStory, activeScene);
}
function nextScene() {
  if (!activeStory) return;
  stopNarration();
  const prior = Number(currentProgress.scenes[activeStory.id] || 0);
  currentProgress.scenes[activeStory.id] = Math.max(prior, activeScene + 1);
  saveProgress();
  void syncCloudSceneProgress(currentProgress.scenes[activeStory.id]);
  renderProgress();
  if (activeScene < 2) {
    activeScene += 1;
    renderScene();
  } else {
    stopMusic();
    closeModal('storyModal');
    openQuiz(activeStory);
  }
}

// Three.js story-world renderer. Environments and characters are created procedurally
// so the site works without paid 3D assets or API keys.
function mat(color, roughness = 0.8, metalness = 0.02, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}
function addMesh(group, geometry, material, position, scale, name = '') {
  const mesh = new THREE.Mesh(geometry, material);
  if (position) mesh.position.set(...position);
  if (scale) mesh.scale.set(...scale);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}
function addCylinderBetween(group, start, end, radius, material) {
  const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
  const direction = new THREE.Vector3().subVectors(b, a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 8), material);
  mesh.position.copy(a).add(b).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}
function makePerson(group, x, z, bodyColor = '#8866c7', hairColor = '#302446', scale = 1, accessory = '#f4b3da') {
  const person = new THREE.Group();
  person.position.set(x, 0, z);
  person.scale.setScalar(scale);
  const skin = mat('#e7ad91'), hair = mat(hairColor), body = mat(bodyColor), pants = mat('#333d68'), shoes = mat('#211d39');
  addMesh(person, new THREE.CapsuleGeometry(.23, .48, 4, 8), body, [0, .78, 0], [1, 1, 1], 'story character');
  addMesh(person, new THREE.SphereGeometry(.25, 16, 12), skin, [0, 1.43, 0], [1, 1, .92]);
  addMesh(person, new THREE.SphereGeometry(.255, 16, 9, 0, Math.PI * 2, 0, Math.PI * .58), hair, [0, 1.53, -.015], [1.03, .9, 1]);
  addMesh(person, new THREE.SphereGeometry(.045, 8, 8), mat('#251d35'), [-.09, 1.43, .22], [1, 1, .4]);
  addMesh(person, new THREE.SphereGeometry(.045, 8, 8), mat('#251d35'), [.09, 1.43, .22], [1, 1, .4]);
  addCylinderBetween(person, [-.18, .97, 0], [-.32, .49, .03], .075, pants);
  addCylinderBetween(person, [.18, .97, 0], [.32, .49, .03], .075, pants);
  addMesh(person, new THREE.SphereGeometry(.105, 10, 8), shoes, [-.32, .45, .07], [1.2, .55, 1.5]);
  addMesh(person, new THREE.SphereGeometry(.105, 10, 8), shoes, [.32, .45, .07], [1.2, .55, 1.5]);
  addCylinderBetween(person, [-.22, 1.06, 0], [-.48, .78, .16], .065, skin);
  addCylinderBetween(person, [.22, 1.06, 0], [.48, .78, .16], .065, skin);
  addMesh(person, new THREE.SphereGeometry(.07, 10, 8), mat(accessory, .4, .1, { emissive: accessory, emissiveIntensity: .1 }), [0, 1.07, .2], [.7, .7, .3]);
  group.add(person);
  return person;
}
function makeSpider(group, x, z) {
  const spider = new THREE.Group();
  spider.position.set(x, .58, z);
  const dark = mat('#29244c'), abdomen = mat('#513c7c'), eye = mat('#ffd9a8', .2, .05, { emissive: '#ffbb8b', emissiveIntensity: .45 });
  addMesh(spider, new THREE.SphereGeometry(.36, 18, 12), abdomen, [0, 0, -.28], [1.2, .8, 1.2]);
  addMesh(spider, new THREE.SphereGeometry(.23, 16, 12), dark, [0, .03, .2]);
  for (let i = 0; i < 8; i++) {
    const side = i % 2 ? 1 : -1;
    const row = Math.floor(i / 2);
    const zOff = -.22 + row * .15;
    const joint = [side * (.42 + row * .015), -.04 + (row % 2) * .05, zOff];
    const foot = [side * (.77 + row * .02), -.26, zOff + (row - 1.5) * .07];
    addCylinderBetween(spider, [side * .12, 0, zOff], joint, .045, dark);
    addCylinderBetween(spider, joint, foot, .035, dark);
  }
  addMesh(spider, new THREE.SphereGeometry(.045, 9, 8), eye, [-.09, .1, .39]);
  addMesh(spider, new THREE.SphereGeometry(.045, 9, 8), eye, [.09, .1, .39]);
  group.add(spider);
  return spider;
}
function makeTree(group, x, z, scale = 1, leafColor = '#4b9b91') {
  const tree = new THREE.Group();
  tree.position.set(x, 0, z);
  tree.scale.setScalar(scale);
  addMesh(tree, new THREE.CylinderGeometry(.15, .23, 1.55, 8), mat('#725071'), [0, .77, 0]);
  const leafMat = mat(leafColor, .85, 0, { roughness: .9 });
  addMesh(tree, new THREE.IcosahedronGeometry(.8, 1), leafMat, [0, 1.75, 0], [1, 1.12, 1]);
  addMesh(tree, new THREE.IcosahedronGeometry(.58, 1), leafMat, [-.4, 2.02, .05], [1, 1, 1]);
  group.add(tree);
  return tree;
}
function makeTurtle(group, x, z) {
  const turtle = new THREE.Group();
  turtle.position.set(x, .25, z);
  const green = mat('#63bb9a'), shell = mat('#286e78'), shellLight = mat('#63c8b8');
  addMesh(turtle, new THREE.SphereGeometry(.43, 18, 12), shell, [0, .3, 0], [1.18, .65, 1]);
  addMesh(turtle, new THREE.SphereGeometry(.32, 14, 10), green, [0, .27, .43], [.65, .58, .95]);
  addMesh(turtle, new THREE.SphereGeometry(.15, 12, 10), green, [0, .39, .71], [1, .95, 1]);
  addMesh(turtle, new THREE.SphereGeometry(.04, 8, 8), mat('#162a48'), [-.07, .43, .84]);
  addMesh(turtle, new THREE.SphereGeometry(.04, 8, 8), mat('#162a48'), [.07, .43, .84]);
  [[-.4,.05,-.25],[.4,.05,-.25],[-.4,.05,.27],[.4,.05,.27]].forEach(([a,b,c]) => addMesh(turtle, new THREE.SphereGeometry(.17, 10, 8), green, [a,b,c], [1,.5,1.3]));
  addMesh(turtle, new THREE.CircleGeometry(.27, 6), shellLight, [0, .62, 0], [1,1,1]).rotation.x = -Math.PI/2;
  group.add(turtle);
  return turtle;
}
function addGround(sceneGroup, color) {
  const ground = addMesh(sceneGroup, new THREE.CircleGeometry(5.7, 64), mat(color, 1), [0, -.07, 0], [1,1,1], 'world ground');
  ground.rotation.x = -Math.PI / 2;
  return ground;
}
function addStars(scene, count = 250, radius = 13) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const y = Math.random() * 8 - 1;
    const r = radius * (.7 + Math.random() * .3);
    positions[i*3] = Math.cos(angle) * r;
    positions[i*3+1] = y;
    positions[i*3+2] = Math.sin(angle) * r;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#dfd4ff', size: .045, transparent: true, opacity: .7 }));
  scene.add(points);
  return points;
}
function addClickable(mesh, message, clickables) {
  if (mesh) {
    mesh.userData.storyObject = true;
    mesh.userData.message = message;
    clickables.push(mesh);
  }
}
function buildThreeScene(story, sceneIndex) {
  stageEl.innerHTML = '<div class="stage-loading"><span class="loader-orb"></span><p>Building your story world…</p></div>';
  let renderer, scene, camera, controls, resizeObserver, animationId;
  const clickables = [];
  const animated = [];
  const sceneGroup = new THREE.Group();
  const sceneBackgrounds = story.world === 'web' ? ['#27204d','#1c2450','#25345b'] : story.world === 'forest' ? ['#153f48','#16494b','#1d4c47'] : ['#0d3d69','#104c72','#0b3d65'];
  const bg = new THREE.Color(sceneBackgrounds[sceneIndex] || sceneBackgrounds[0]);
  try {
    scene = new THREE.Scene();
    scene.background = bg;
    scene.fog = new THREE.Fog(bg, 8, 19);
    camera = new THREE.PerspectiveCamera(42, 1, .1, 100);
    camera.position.set(0, 3.4, 7.6);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.xr.enabled = true;
    stageEl.innerHTML = '';
    stageEl.appendChild(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = .055;
    controls.minDistance = 4.5;
    controls.maxDistance = 10;
    controls.maxPolarAngle = Math.PI * .48;
    controls.target.set(0, 1, 0);
    scene.add(new THREE.HemisphereLight('#d9deff', '#40315c', 2.15));
    const keyLight = new THREE.DirectionalLight('#fff1d9', 3.1);
    keyLight.position.set(-4, 8, 5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(512, 512);
    scene.add(keyLight);
    const rim = new THREE.PointLight(story.accent || '#b99cff', 5, 15);
    rim.position.set(4, 3, -3);
    scene.add(rim);
    scene.add(sceneGroup);
    const stars = addStars(scene, 180);
    const clickMessage = story.scenes[sceneIndex].objectMessage || 'You found a hidden detail in this story world.';

    if (story.world === 'web') {
      addGround(sceneGroup, sceneIndex === 2 ? '#43518b' : '#38416c');
      makeTree(sceneGroup, -3.1, -1.1, 1.35, '#4e9b92');
      makeTree(sceneGroup, 3.2, -1.7, 1.12, '#5db2a4');
      makeTree(sceneGroup, -2.5, 2.7, .75, '#528b98');
      const webMat = new THREE.LineBasicMaterial({ color: '#e8d8ff', transparent: true, opacity: .72 });
      const webPoints = [];
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2;
        webPoints.push(new THREE.Vector3(Math.cos(a) * 1.1, 2.2 + Math.sin(a) * .45, -1.25 + Math.sin(a) * .15));
      }
      const webGeo = new THREE.BufferGeometry().setFromPoints(webPoints);
      const webLine = new THREE.LineLoop(webGeo, webMat);
      sceneGroup.add(webLine);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        const pts = [new THREE.Vector3(0,2.2,-1.25),new THREE.Vector3(Math.cos(a)*1.1,2.2+Math.sin(a)*.45,-1.25+Math.sin(a)*.15)];
        sceneGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), webMat));
      }
      const spider = makeSpider(sceneGroup, -.65, .7);
      animated.push({ object: spider, type: 'bob', speed: 1.5, base: .58 });
      if (sceneIndex === 0) {
        const jar = addMesh(sceneGroup, new THREE.CylinderGeometry(.28,.33,.72,24), mat('#c27eae',.22,.2,{transparent:true,opacity:.85,emissive:'#642c78',emissiveIntensity:.3}), [.9,.53,.3], null, 'wisdom jar');
        const lid = addMesh(sceneGroup, new THREE.CylinderGeometry(.32,.32,.11,20), mat('#f2ca8e',.35), [.9,.95,.3]);
        addMesh(sceneGroup, new THREE.TorusGeometry(.31,.045,8,24), mat('#f8d7a6'), [.9,.65,.3]);
        addClickable(jar, clickMessage, clickables); addClickable(lid, clickMessage, clickables);
        animated.push({object:jar,type:'turn',speed:.45});
      } else if (sceneIndex === 1) {
        makePerson(sceneGroup, 1.45, .25, '#4d83a6', '#382b46', .9, '#91e2d3');
        const webOrb = addMesh(sceneGroup, new THREE.IcosahedronGeometry(.35,1), mat('#edbcff',.2,.1,{emissive:'#c57aff',emissiveIntensity:1}), [1.5,2.1,-.35]);
        addClickable(webOrb, clickMessage, clickables); animated.push({object:webOrb,type:'bob',speed:1.8,base:2.1});
      } else {
        const shards = new THREE.Group();
        for (let i=0;i<7;i++) {
          const orb = addMesh(shards,new THREE.IcosahedronGeometry(.13+Math.random()*.09,1),mat('#ffd990',.25,.1,{emissive:'#f9b850',emissiveIntensity:.8}),[(Math.random()-.5)*2.4,.7+Math.random()*1.4,(Math.random()-.5)*1.8]);
          addClickable(orb, clickMessage, clickables);
          animated.push({object:orb,type:'bob',speed:1+Math.random(),base:orb.position.y});
        }
        sceneGroup.add(shards);
      }
    } else if (story.world === 'forest') {
      addGround(sceneGroup, '#326c5c');
      makeTree(sceneGroup,-3.15,-1,1.45,'#388c79');
      makeTree(sceneGroup,3.15,-1.35,1.35,'#4f9b77');
      makeTree(sceneGroup,-2.45,2.2,.85,'#3c9075');
      makeTree(sceneGroup,2.4,2.4,.8,'#3d816e');
      const path = addMesh(sceneGroup,new THREE.PlaneGeometry(2.1,7),mat('#927c69'),[0,.015,0]); path.rotation.x=-Math.PI/2; path.rotation.z=.12;
      makePerson(sceneGroup,-.8,.2,'#b16e9a','#2d263c',.92,'#f4c48d');
      makePerson(sceneGroup,.15,.45,'#568bb2','#34304a',.87,'#8ee2d0');
      makePerson(sceneGroup,1.05,.15,'#cb8d55','#432d37',.9,'#a8a0ff');
      if (sceneIndex === 0) {
        for (let i=0;i<5;i++) {
          const fern=addMesh(sceneGroup,new THREE.ConeGeometry(.26,.8,7),mat('#6ec69c'),[-2.2+i*.25,.42,1.3+i*.08],[.8,1.1,.65]);
          fern.rotation.z=(i-2)*.22;
          if(i===2)addClickable(fern,clickMessage,clickables);
        }
        const mist = addMesh(sceneGroup,new THREE.SphereGeometry(1.6,16,10),new THREE.MeshBasicMaterial({color:'#b8e6e3',transparent:true,opacity:.12,depthWrite:false}),[0,1.8,-1],[1.8,.7,1]);
        animated.push({object:mist,type:'drift',speed:.25});
      } else if (sceneIndex === 1) {
        const stream=addMesh(sceneGroup,new THREE.PlaneGeometry(1.25,6),new THREE.MeshStandardMaterial({color:'#68d2d5',roughness:.18,metalness:.22,transparent:true,opacity:.82}),[-.15,.035,-.1]); stream.rotation.x=-Math.PI/2; stream.rotation.z=.18;
        const flowerMat=mat('#82dcf2',.3,.05,{emissive:'#298fa8',emissiveIntensity:.7});
        for(let i=0;i<6;i++){
          const flower=addMesh(sceneGroup,new THREE.SphereGeometry(.18,10,8),flowerMat,[1.6+(i%2)*.3,.5,-1.5+i*.65],[1,.55,1]);
          addClickable(flower,clickMessage,clickables); animated.push({object:flower,type:'bob',speed:1.3+i*.1,base:.5});
        }
      } else {
        const ribbon=addMesh(sceneGroup,new THREE.BoxGeometry(.12,1.25,.05),mat('#ff9ac9',.4,0,{emissive:'#ad4985',emissiveIntensity:.3}),[-2.3,1.35,-.6]);
        ribbon.rotation.z=-.25; addClickable(ribbon,clickMessage,clickables); animated.push({object:ribbon,type:'sway',speed:1.5});
        const marker=addMesh(sceneGroup,new THREE.BoxGeometry(.55,.65,.12),mat('#d8c6a0'),[2.15,.45,-.5]); addClickable(marker,clickMessage,clickables);
      }
    } else {
      addGround(sceneGroup,'#145a77');
      for(let i=0;i<9;i++){
        const coral=addMesh(sceneGroup,new THREE.ConeGeometry(.18,.8+(i%3)*.22,7),mat(i%2?'#e78cae':'#6bd4cf'),[-3.4+(i%5)*1.45,.45,-2.2+Math.floor(i/5)*2.4],[1,1,1]);
        coral.rotation.z=(i%2?-.18:.16);
      }
      const turtle=makeTurtle(sceneGroup,-.85,.15);
      animated.push({object:turtle,type:'bob',speed:.85,base:.25});
      if(sceneIndex===0){
        const shell=addMesh(sceneGroup,new THREE.SphereGeometry(.47,22,14),mat('#73d6f0',.2,.1,{emissive:'#208cb8',emissiveIntensity:1}),[1.4,.42,.15],[1,.55,.72]);
        const shellRing=addMesh(sceneGroup,new THREE.TorusGeometry(.5,.045,8,30),mat('#b1f5ff',.3,.2,{emissive:'#3da9d0',emissiveIntensity:.6}),[1.4,.45,.15]); shellRing.rotation.x=Math.PI/2;
        addClickable(shell,clickMessage,clickables); addClickable(shellRing,clickMessage,clickables); animated.push({object:shell,type:'pulse',speed:1.8});
      }else if(sceneIndex===1){
        const netMat=new THREE.LineBasicMaterial({color:'#e6d7bd',transparent:true,opacity:.83});
        const coords=[[-1.2,.3,-1.1],[1.5,.7,-.8],[1.8,.2,.8],[-1.1,.6,.9]];
        const points=coords.map(p=>new THREE.Vector3(...p));
        const net=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points),netMat); sceneGroup.add(net); addClickable(net,clickMessage,clickables);
        for(let i=0;i<5;i++){
          const fish=addMesh(sceneGroup,new THREE.SphereGeometry(.16,12,8),mat('#ffb77e'),[-1+i*.48,.55,-.25+i*.13],[1.35,.7,.55]);
          addClickable(fish,clickMessage,clickables); animated.push({object:fish,type:'bob',speed:1.2+i*.13,base:.55});
        }
      } else {
        const coralGlow=addMesh(sceneGroup,new THREE.IcosahedronGeometry(.52,1),mat('#f2a6d4',.25,.05,{emissive:'#d34fbb',emissiveIntensity:.85}),[1.35,.95,-.5],[1,1.6,.8]);
        addClickable(coralGlow,clickMessage,clickables); animated.push({object:coralGlow,type:'pulse',speed:1.3});
        const marker=addMesh(sceneGroup,new THREE.CylinderGeometry(.08,.08,.7,10),mat('#e9d18c'),[2.1,.42,.5]); addClickable(marker,clickMessage,clickables);
      }
    }
    const reticle = new THREE.Mesh(new THREE.RingGeometry(.12,.18,32), new THREE.MeshBasicMaterial({color:'#c8fff5',side:THREE.DoubleSide}));
    reticle.rotation.x = -Math.PI/2;
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hitTestSource = null;
    let placedInAR = false;
    let arSession = null;
    let disposed = false;
    const xrController = renderer.xr.getController(0);
    xrController.addEventListener('select', placeInAR);
    scene.add(xrController);

    function onPointerDown(event) {
      if (renderer.xr.isPresenting) {
        if (reticle.visible) placeInAR();
        return;
      }
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(clickables, true)[0];
      if (hit) {
        const target = hit.object;
        const message = target.userData.message || clickMessage;
        showToast(message);
        if ('speechSynthesis' in window) speakText(message, 'Story discovery');
      }
    }
    function placeInAR() {
      if (!renderer.xr.isPresenting || placedInAR) return;
      if (reticle.visible) {
        sceneGroup.position.setFromMatrixPosition(reticle.matrix);
        sceneGroup.quaternion.setFromRotationMatrix(reticle.matrix);
      } else {
        sceneGroup.position.set(0, 0, -1.15);
      }
      sceneGroup.scale.setScalar(.27);
      reticle.visible = false;
      placedInAR = true;
      showToast('Story world placed! Move around to explore.');
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.xr.addEventListener('sessionstart', async () => {
      scene.background = null;
      scene.fog = null;
      placedInAR = false;
      sceneGroup.scale.setScalar(.27);
      sceneGroup.position.set(0, 0, -1.15);
      reticle.visible = false;
      arSession = renderer.xr.getSession();
      try {
        const viewerSpace = await arSession.requestReferenceSpace('viewer');
        hitTestSource = await arSession.requestHitTestSource({ space: viewerSpace });
      } catch { hitTestSource = null; }
    });
    renderer.xr.addEventListener('sessionend', () => {
      hitTestSource = null;
      reticle.visible = false;
      sceneGroup.scale.setScalar(1);
      sceneGroup.position.set(0,0,0);
      sceneGroup.rotation.set(0,0,0);
      scene.background = bg;
      scene.fog = new THREE.Fog(bg,8,19);
      placedInAR = false;
      arSession = null;
    });
    renderer.setAnimationLoop((time, frame) => {
      if (disposed) return;
      const t = time * .001;
      controls.update();
      animated.forEach(item => {
        if (item.type === 'bob') item.object.position.y = item.base + Math.sin(t * item.speed) * .11;
        if (item.type === 'turn') item.object.rotation.y = Math.sin(t * item.speed) * .34;
        if (item.type === 'drift') item.object.position.x = Math.sin(t * item.speed) * .17;
        if (item.type === 'sway') item.object.rotation.z = -.25 + Math.sin(t * item.speed) * .18;
        if (item.type === 'pulse') { const s = 1 + Math.sin(t * item.speed) * .08; item.object.scale.set(s,s,s); }
      });
      stars.rotation.y = t * .012;
      if (frame && hitTestSource && !placedInAR) {
        const hits = frame.getHitTestResults(hitTestSource);
        if (hits.length) {
          const pose = hits[0].getPose(renderer.xr.getReferenceSpace());
          if (pose) { reticle.visible = true; reticle.matrix.fromArray(pose.transform.matrix); }
        } else reticle.visible = false;
      }
      renderer.render(scene,camera);
    });
    const resize = () => {
      if (!renderer || disposed) return;
      const width = Math.max(1, stageEl.clientWidth);
      const height = Math.max(1, stageEl.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width,height,false);
    };
    resize();
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(stageEl);
    const arButton = $('#arLaunch');
    const arLabel = $('#arSupportLabel');
    arButton.disabled = true;
    arButton.textContent = '◎ CHECKING AR…';
    if (navigator.xr && window.isSecureContext) {
      navigator.xr.isSessionSupported('immersive-ar').then(supported => {
        if (!disposed) {
          arButton.disabled = !supported;
          arButton.textContent = supported ? '◎ TRY AR VIEW' : '◎ 3D VIEW ACTIVE';
          arLabel.textContent = supported ? 'Place this world in your space' : 'Immersive AR is not supported here; rotate the 3D scene instead.';
        }
      }).catch(() => {
        arButton.disabled = true;
        arButton.textContent = '◎ 3D VIEW ACTIVE';
        arLabel.textContent = 'Use the interactive 3D view on this device.';
      });
    } else {
      arButton.disabled = true;
      arButton.textContent = '◎ 3D VIEW ACTIVE';
      arLabel.textContent = !window.isSecureContext ? 'AR needs a secure HTTPS site. 3D mode is ready.' : 'This browser does not expose WebXR AR. 3D mode is ready.';
    }
    arButton.onclick = () => {
      if (!navigator.xr || !window.isSecureContext) return showToast('Open the published HTTPS site on a WebXR-compatible device to try AR.');
      // requestSession is invoked directly from this tap to preserve the browser user gesture.
      const request = navigator.xr.requestSession('immersive-ar', { optionalFeatures: ['hit-test','dom-overlay'], domOverlay: { root: document.body } });
      request.then(session => renderer.xr.setSession(session)).catch(error => {
        console.warn('AR session was not started:', error);
        showToast('AR could not start here. The interactive 3D scene is still available.');
      });
    };
    threeExperience = {
      dispose() {
        disposed = true;
        try { if (renderer.xr.isPresenting) renderer.xr.getSession()?.end(); } catch {}
        renderer.setAnimationLoop(null);
        renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        controls.dispose();
        resizeObserver?.disconnect();
        renderer.dispose();
        stageEl.innerHTML = '';
      }
    };
  } catch (error) {
    console.error('3D scene error:', error);
    stageEl.innerHTML = '<div class="stage-loading"><span class="loader-orb"></span><p>3D mode is unavailable on this device. You can still read and listen to the story below.</p></div>';
    $('#arLaunch').disabled = true;
    $('#arLaunch').textContent = '3D VIEW UNAVAILABLE';
    $('#arSupportLabel').textContent = 'Try a recent browser with WebGL enabled.';
  }
}
function disposeThree() {
  if (threeExperience) threeExperience.dispose();
  threeExperience = null;
}

function openQuiz(story) {
  quizState = { story, index: 0, selected: null, answered: false, score: 0, finished: false, responses: [] };
  $('#quizTitle').textContent = `${story.title}: quick check`;
  $('#quizIntro').textContent = 'Think back to the characters, clues, vocabulary, and big idea in the story.';
  $('#quizResult').hidden = true;
  $('#quizContent').hidden = false;
  $('#quizNext').hidden = false;
  renderQuizQuestion();
  openModal('quizModal');
}
function renderQuizQuestion() {
  const q = quizState.story.quiz[quizState.index];
  quizState.selected = null;
  quizState.answered = false;
  const total = quizState.story.quiz.length;
  $('#quizQuestionCounter').textContent = `QUESTION ${quizState.index + 1} OF ${total}`;
  $('#quizProgressLabel').textContent = `${Math.round(quizState.index / total * 100)}%`;
  $('#quizProgressBar').style.width = `${quizState.index / total * 100}%`;
  $('#quizContent').innerHTML = `<h3>${escapeHtml(q.question)}</h3><div class="quiz-options">${q.choices.map((choice,index)=>`<button class="quiz-option" data-answer="${index}"><span class="option-letter">${String.fromCharCode(65+index)}</span><span>${escapeHtml(choice)}</span></button>`).join('')}</div><div class="answer-feedback" id="answerFeedback" hidden></div>`;
  $$('[data-answer]').forEach(button => button.addEventListener('click', () => {
    if (quizState.answered) return;
    quizState.selected = Number(button.dataset.answer);
    $$('[data-answer]').forEach(el => el.classList.toggle('selected', el === button));
    $('#quizNext').disabled = false;
  }));
  $('#quizNext').textContent = 'SAVE ANSWER';
  $('#quizNext').disabled = true;
}
async function quizAdvance() {
  if (!quizState) return;
  if (!quizState.answered) {
    if (quizState.selected === null) return;
    const q = quizState.story.quiz[quizState.index];
    quizState.responses.push({
      selected: quizState.selected,
      question: q.question,
      choices: q.choices,
      explanation: q.explanation || '',
    });
    quizState.answered = true;
    $$('[data-answer]').forEach(button => { button.disabled = true; });
    const feedback = $('#answerFeedback');
    feedback.hidden = false;
    feedback.className = 'answer-feedback';
    feedback.textContent = cloudSupabase && cloudStudentId && cloudClassId
      ? 'Answer saved. Your teacher’s classroom will score the full quiz when you submit it.'
      : 'Answer saved for this practice session. Join your teacher’s classroom and open the assigned story to submit a scored quiz.';
    $('#quizNext').textContent = quizState.index === quizState.story.quiz.length - 1 ? 'SUBMIT QUIZ' : 'NEXT QUESTION';
  } else if (quizState.index < quizState.story.quiz.length - 1) {
    quizState.index++;
    renderQuizQuestion();
  } else {
    await showQuizResult();
  }
}

async function showQuizResult() {
  quizState.finished = true;
  const total = quizState.story.quiz.length;
  let score = null;
  let submitMessage = '';

  $('#quizNext').disabled = true;
  $('#quizNext').textContent = 'SUBMITTING…';

  if (cloudSupabase && cloudStudentId && cloudClassId) {
    try {
      const answers = quizState.responses.map(item => item.selected);
      const { data, error } = await cloudSupabase.rpc('submit_storyverse_quiz', {
        p_class_id: cloudClassId,
        p_story_id: quizState.story.id,
        p_answers: answers,
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result || !Number.isInteger(Number(result.score)) || !Number.isInteger(Number(result.total))) {
        throw new Error('The server returned an incomplete quiz result.');
      }
      score = Number(result.score);
      submitMessage = 'Your scored result has been saved to your classroom.';
    } catch (error) {
      console.error('Quiz submission failed:', error);
      submitMessage = 'We could not submit this quiz to your classroom. Check your internet connection, then ask your teacher to refresh the class dashboard. Your answers have not been counted as a saved score.';
      showToast('Quiz score did not sync to your classroom.');
    }
  } else {
    submitMessage = 'Practice session only. To record a score your teacher can see, log in, join a class with its code, and open this story from the assigned-stories list.';
  }

  currentProgress.completed = [...new Set([...(currentProgress.completed || []), quizState.story.id])];
  if (score !== null) {
    currentProgress.results = currentProgress.results || [];
    currentProgress.results.unshift({ storyId: quizState.story.id, title: quizState.story.title, score, total, date: new Date().toISOString() });
    currentProgress.results = currentProgress.results.slice(0, 12);
  }
  saveProgress();
  renderProgress();

  const pct = score === null ? null : Math.round(score / total * 100);
  $('#quizQuestionCounter').textContent = score === null ? 'PRACTICE SESSION' : 'YOUR STORYVERSE RESULT';
  $('#quizProgressLabel').textContent = '100%';
  $('#quizProgressBar').style.width = '100%';
  $('#quizContent').hidden = true;
  $('#quizNext').hidden = true;
  const result = $('#quizResult');
  result.hidden = false;

  const reviewHtml = quizState.responses.map((response) =>
    `<div class="review-line">${escapeHtml(response.question)}<br/><span>Your answer: ${escapeHtml(response.choices[response.selected] || 'No answer')}</span><br/><span>${escapeHtml(response.explanation)}</span></div>`
  ).join('');

  const headline = score === null ? 'Quiz submitted status unavailable' : `${score} / ${total}`;
  const performance = pct === null ? 'Practice mode' : `${pct}% · ${pct >= 80 ? 'STORY EXPLORER' : pct >= 60 ? 'CURIOUS READER' : 'KEEP PRACTISING'}`;
  result.innerHTML = `<strong>${headline}</strong><p><b>${performance}</b><br/>${escapeHtml(submitMessage)}</p><div class="quiz-review">${reviewHtml}</div>`;
  const done = document.createElement('button');
  done.className = 'button button-primary';
  done.textContent = 'BACK TO STORYVERSE';
  done.style.marginTop = '17px';
  done.addEventListener('click', () => {
    closeModal('quizModal');
    activeStory = null;
    document.getElementById('progress').scrollIntoView({ behavior: 'smooth' });
  });
  result.appendChild(done);
}

function renderProgress() {
  currentProgress = currentProgress || { name:'', scenes:{}, completed:[], results:[] };
  const totalStories = storyData?.stories.length || 3;
  const scenes = storyData?.stories.reduce((sum,story)=>sum+Math.min(3,Number(currentProgress.scenes?.[story.id]||0)),0) || 0;
  const completed = currentProgress.completed?.length || 0;
  const results = currentProgress.results || [];
  const avg = results.length ? Math.round(results.reduce((sum,item)=>sum+(item.score/item.total*100),0)/results.length) : null;
  $('#statStories').textContent = `${completed}`;
  $('#statScenes').textContent = `${scenes}/${totalStories*3}`;
  $('#statAverage').textContent = avg === null ? '—' : `${avg}%`;
  $('#studentName').value = currentProgress.name || '';
  $('#storyProgressList').innerHTML = storyData.stories.map(story=>{
    const count = Math.min(3,Number(currentProgress.scenes?.[story.id]||0));
    return `<div class="progress-row"><span class="progress-row-title">${escapeHtml(story.title)}</span><small>${count}/3 scenes</small><div class="progress-bar"><span style="width:${count/3*100}%"></span></div></div>`;
  }).join('');
  $('#recentResults').innerHTML = results.length ? results.slice(0,5).map(item=>{
    const date = new Date(item.date);
    return `<div class="result-row"><div><div class="result-title">${escapeHtml(item.title)}</div><div class="result-date">${Number.isNaN(date.getTime())?'Recent attempt':date.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}</div></div><div class="result-score">${item.score}/${item.total}</div></div>`;
  }).join('') : '<p class="empty-note">No quiz results yet. Finish a story to see your score.</p>';
}

function openScanner() {
  openModal('scannerModal');
  $('#scannerStatus').textContent = 'Tap “Start camera” and allow camera access when your browser asks.';
  $('#startScanner').disabled = false;
  $('#startScanner').textContent = 'START CAMERA';
}
async function startQrScanner() {
  if (!window.Html5Qrcode) return showToast('The QR scanner could not load. Check your internet connection and reload.');
  if (!window.isSecureContext && location.hostname !== 'localhost') {
    $('#scannerStatus').textContent = 'Camera scanning requires HTTPS. Publish this site or open it on localhost. You can still upload a QR image.';
  }
  try {
    if (!scanner) scanner = new Html5Qrcode('qr-reader', { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE], verbose: false });
    $('#startScanner').disabled = true;
    $('#scannerStatus').textContent = 'Requesting camera permission…';
    await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 230, height: 230 }, aspectRatio: 1 }, decoded => handleQr(decoded), () => {});
    qrScannerRunning = true;
    $('#scannerStatus').textContent = 'Camera is on. Hold a STORYVERSE code inside the frame.';
    $('#startScanner').textContent = 'CAMERA READY';
  } catch (error) {
    console.error('QR camera error:', error);
    $('#startScanner').disabled = false;
    $('#scannerStatus').textContent = 'Could not start the camera. Check browser permission, HTTPS, and that another app is not using the camera. You can upload a QR image instead.';
  }
}
async function stopQrScanner() {
  if (scanner && qrScannerRunning) {
    try { await scanner.stop(); } catch {}
    qrScannerRunning = false;
  }
}
function storyIdFromQr(decoded) {
  const value = String(decoded || '').trim();
  if (findStory(value)) return value;
  if (/^storyverse:/i.test(value)) {
    const token = value.split(/[/:]/).filter(Boolean).pop();
    if (findStory(token)) return token;
  }
  try {
    const url = new URL(value);
    const id = url.searchParams.get('story') || url.pathname.split('/').filter(Boolean).pop();
    if (findStory(id)) return id;
  } catch {}
  const match = value.match(/(?:story=|storyverse[:/])([a-z0-9_-]+)/i);
  if (match && findStory(match[1])) return match[1];
  return null;
}
async function handleQr(decoded) {
  const id = storyIdFromQr(decoded);
  if (!id) {
    $('#scannerStatus').textContent = 'That QR code is not a STORYVERSE story code. Try one of the codes in this library.';
    return;
  }
  await stopQrScanner();
  closeModal('scannerModal');
  showToast(`Story found: ${findStory(id).title}`);
  openStory(id);
}
async function scanQrImage(file) {
  if (!file || !window.Html5Qrcode) return;
  try {
    if (!scanner) scanner = new Html5Qrcode('qr-reader', { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE], verbose: false });
    $('#scannerStatus').textContent = 'Reading QR image…';
    const decoded = await scanner.scanFile(file, true);
    await handleQr(decoded);
  } catch (error) {
    console.warn('QR image scan failed:', error);
    $('#scannerStatus').textContent = 'Could not read a QR code from that image. Try a clearer, well-lit photo.';
  }
}

function openEditor() {
  $('#editorJson').value = JSON.stringify(storyData, null, 2);
  $('#editorStatus').textContent = 'Tip: keep exactly 3 scenes per story. Each quiz answer is the zero-based choice index (A = 0).';
  openModal('editorModal');
}
function saveEditorPreview() {
  try {
    const parsed = JSON.parse($('#editorJson').value);
    validateStoryData(parsed);
    storyData = parsed;
    localStorage.setItem(EDITOR_KEY, JSON.stringify(storyData));
    renderStoryLibrary();
    renderProgress();
    $('#editorStatus').textContent = 'Saved to this browser. Export the JSON and replace data/stories.json to publish your changes for everyone.';
    showToast('Story edits saved in this browser.');
  } catch (error) {
    $('#editorStatus').textContent = `Could not save: ${error.message}`;
    showToast('Check your JSON formatting and required story fields.');
  }
}
function resetEditor() {
  storyData = structuredClone(baseData);
  localStorage.removeItem(EDITOR_KEY);
  $('#editorJson').value = JSON.stringify(storyData, null, 2);
  renderStoryLibrary();
  renderProgress();
  $('#editorStatus').textContent = 'Restored the original stories for this browser.';
}
function downloadStoriesJson() {
  try {
    const parsed = JSON.parse($('#editorJson').value);
    validateStoryData(parsed);
    const blob = new Blob([JSON.stringify(parsed,null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'stories.json'; a.click();
    URL.revokeObjectURL(url);
    $('#editorStatus').textContent = 'Exported stories.json. Replace the file in your site’s data folder to publish edits.';
  } catch (error) {
    $('#editorStatus').textContent = `Export failed: ${error.message}`;
  }
}

function wireEvents() {
  $('#heroScan').addEventListener('click',openScanner);
  $('#navScan').addEventListener('click',openScanner);
  $('#closeScanner').addEventListener('click',async()=>{await stopQrScanner();closeModal('scannerModal');});
  $('#startScanner').addEventListener('click',startQrScanner);
  $('#qrImageInput').addEventListener('change',event=>scanQrImage(event.target.files?.[0]));
  $('#openFirstStory').addEventListener('click',async()=>{await stopQrScanner();closeModal('scannerModal');openStory(storyData.stories[0].id);});
  $('#closeStory').addEventListener('click',()=>{stopNarration();stopMusic();disposeThree();closeModal('storyModal');});
  $('#nextScene').addEventListener('click',nextScene);
  $('#narrationToggle').addEventListener('click',toggleNarration);
  $('#musicToggle').addEventListener('click',toggleMusic);
  $('#pronounceButton').addEventListener('click',()=>showToast('Tap a vocabulary word above to hear it pronounced.'));
  $('#saveName').addEventListener('click',()=>{
    currentProgress.name = $('#studentName').value.trim().slice(0,24);
    saveProgress();
    showToast(`Welcome, ${currentProgress.name || 'story explorer'}!`);
  });
  $('#studentName').addEventListener('keydown',event=>{if(event.key==='Enter')$('#saveName').click();});
  $('#quizNext').addEventListener('click',quizAdvance);
  $('#openEditor').addEventListener('click',openEditor);
  $('#closeEditor').addEventListener('click',()=>closeModal('editorModal'));
  $('#saveEditor').addEventListener('click',saveEditorPreview);
  $('#resetEditor').addEventListener('click',resetEditor);
  $('#downloadStories').addEventListener('click',downloadStoriesJson);
  $('#mobileMenuButton').addEventListener('click',()=>{
    const nav=$('#mainNav'); const isOpen=nav.classList.toggle('open');
    $('#mobileMenuButton').setAttribute('aria-expanded',String(isOpen));
    $('#mobileMenuButton').textContent=isOpen?'×':'☰';
  });
  $$('.main-nav a').forEach(a=>a.addEventListener('click',()=>{$('#mainNav').classList.remove('open');$('#mobileMenuButton').setAttribute('aria-expanded','false');$('#mobileMenuButton').textContent='☰';}));
  $$('[data-close="story"]').forEach(el=>el.addEventListener('click',()=>$('#closeStory').click()));
  $$('[data-close="scanner"]').forEach(el=>el.addEventListener('click',()=>$('#closeScanner').click()));
  $$('[data-close="editor"]').forEach(el=>el.addEventListener('click',()=>closeModal('editorModal')));
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){
      if($('#scannerModal').classList.contains('open'))$('#closeScanner').click();
      if($('#storyModal').classList.contains('open'))$('#closeStory').click();
      if($('#editorModal').classList.contains('open'))closeModal('editorModal');
    }
  });
  window.addEventListener('beforeunload',()=>{stopNarration();stopMusic();disposeThree();});
}

$('#yearNow').textContent = new Date().getFullYear();
currentProgress = currentProgress || {name:'',scenes:{},completed:[],results:[]};
wireEvents();
window.addEventListener('load', () => { if (storyData?.stories) storyData.stories.forEach(makeQr); });
loadStories().catch(error=>{
  console.error(error);
  $('#storyGrid').innerHTML = `<div class="loading-card">We couldn’t load the story library. Please run STORYVERSE from a web server and check that data/stories.json is present. (${escapeHtml(error.message)})</div>`;
});
