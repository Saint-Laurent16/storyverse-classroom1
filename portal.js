import { supabase, supabaseConfigured } from './supabase-client.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const fmtDate = value => value ? new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : 'No date set';
const fmtDateTime = value => value ? new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}) : 'Time not set';
const todayISO = () => new Date().toISOString().slice(0,10);
const role = document.body.dataset.portalRole;
const isTeacher = role === 'teacher';
const CHECKLIST_LABEL = 'storyverse-checklist-v1';

const state = {
  user:null, profile:null, authMode:'login', view:'dashboard',
  stories:[], classes:[], members:[], assignments:[], scenes:[], attempts:[],
  assessments:[], events:[], announcements:[], checklist:[],
  selectedClass:null, pendingCode:new URLSearchParams(location.search).get('code') || ''
};

function message(target, text, type='ok') {
  const el = $(target);
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || '';
  el.classList.toggle('error', type === 'error');
}
function busy(button, on, label='PLEASE WAIT…') {
  if (!button) return;
  if (on) { button.dataset.oldText = button.textContent; button.disabled = true; button.textContent = label; }
  else { button.disabled = false; button.textContent = button.dataset.oldText || button.textContent; }
}
function stat(label,value,note,icon='✦') {
  return `<article class="stat-card"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div><div class="stat-note">${esc(note)}</div></article>`;
}
function empty(text) { return `<div class="empty-state">${esc(text)}</div>`; }
function viewHeading(kicker,title,desc,extra='') {
  return `<div class="view-heading"><div><div class="view-kicker">${esc(kicker)}</div><h2>${title}</h2><p>${esc(desc)}</p></div>${extra}</div>`;
}
function setAuthMode(mode) {
  state.authMode = mode;
  $$('[data-auth-mode]').forEach(btn => btn.classList.toggle('is-active',btn.dataset.authMode===mode));
  $$('.signup-only').forEach(el => { el.hidden = mode !== 'signup'; });
  $('#authSubmit').innerHTML = mode === 'login'
    ? `Log in to ${isTeacher?'teacher':'student'} portal <span>→</span>`
    : `Create ${isTeacher?'teacher request':'student account'} <span>→</span>`;
  $('#password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
}

async function submitAuth(event) {
  event.preventDefault();
  message('#authMessage','');
  const button = $('#authSubmit');
  const email = $('#email').value.trim();
  const password = $('#password').value;
  if (password.length < 8) return message('#authMessage','Use a password with at least 8 characters.','error');
  busy(button,true,state.authMode==='login'?'SIGNING IN…':'CREATING ACCOUNT…');
  try {
    if (state.authMode === 'login') {
      const { data, error } = await supabase.auth.signInWithPassword({email,password});
      if (error) throw error;
      await afterSignIn(data.user);
    } else {
      const displayName = $('#displayName')?.value.trim() || (isTeacher ? 'Teacher' : 'Story Explorer');
      const requestedRole = isTeacher ? 'teacher' : 'student';
      const code = !isTeacher ? ($('#inviteCode')?.value.trim().toUpperCase() || state.pendingCode) : '';
      if (code && !/^[A-Z0-9]{5,10}$/.test(code)) throw new Error('Classroom codes use 5–10 letters or numbers.');
      if (code) localStorage.setItem('storyverse-pending-join-v1',code);
      const { data, error } = await supabase.auth.signUp({
        email,password,
        options:{
          data:{display_name:displayName,requested_role:requestedRole},
          emailRedirectTo:new URL(isTeacher?'./teacher.html':'./student.html',location.href).href
        }
      });
      if (error) throw error;
      if (data.session?.user) {
        await afterSignIn(data.user);
      } else {
        message('#authMessage',isTeacher
          ? 'Teacher account created. Your account is pending administrator approval. Once approved, sign in here.'
          : 'Account created! You can now sign in. Your classroom code can be entered here or after sign-in.');
        setAuthMode('login');
      }
    }
  } catch (error) {
    message('#authMessage',error.message || 'Could not complete sign-in. Please try again.','error');
  } finally { busy(button,false); }
}

async function fetchProfile(user) {
  const {data,error} = await supabase.from('profiles').select('id,display_name,role,requested_role,created_at,profile_color,profile_theme,scores_public').eq('id',user.id).single();
  if (error) throw error;
  return data;
}
async function afterSignIn(user) {
  try {
    const profile = await fetchProfile(user);
    if (isTeacher && profile.role !== 'teacher') {
      await supabase.auth.signOut();
      const pending = profile.requested_role === 'teacher';
      message('#authMessage',pending
        ? 'Your teacher account is waiting for administrator approval. You can sign in here again after your teacher role is activated.'
        : 'This account is registered as a student. Please use the Student Portal instead.','error');
      return;
    }
    if (!isTeacher && profile.role !== 'student') {
      await supabase.auth.signOut();
      message('#authMessage','This account has teacher access. Please use the Teacher Portal instead.','error');
      return;
    }
    if (!isTeacher && profile.requested_role === 'teacher') {
      await supabase.auth.signOut();
      message('#authMessage','Your teacher access is still pending approval. Please return after the project administrator activates your teacher role.','error');
      return;
    }
    state.user = user; state.profile = profile;
    $('#authShell').hidden = true;
    $('#dashboardShell').hidden = false;
    $('#userDisplayName').textContent = profile.display_name || (isTeacher?'teacher':'explorer');
    await loadStoryCatalog();
    if (isTeacher) await loadTeacherData(); else await loadStudentData();
    await tryPendingJoin();
    renderView('dashboard');
  } catch (error) {
    message('#authMessage',`${error.message || 'Could not load your profile.'} Check that the STORYVERSE database setup and portal upgrade have been run.`,'error');
    await supabase.auth.signOut().catch(()=>{});
  }
}
async function loadStoryCatalog() {
  try {
    const response = await fetch('./data/stories.json',{cache:'no-cache'});
    if (!response.ok) throw new Error('Story catalogue is missing.');
    const data = await response.json();
    state.stories = Array.isArray(data.stories) ? data.stories : [];
  } catch (error) { console.warn(error); state.stories=[]; }
}

async function loadTeacherData() {
  const {data:classes,error} = await supabase.from('classrooms')
    .select('id,name,grade_level,class_code,is_active,created_at')
    .eq('teacher_id',state.user.id).order('created_at',{ascending:false});
  if (error) throw error;
  state.classes = classes || [];
  const ids = state.classes.map(c=>c.id);
  if (!ids.length) {
    Object.assign(state,{members:[],assignments:[],scenes:[],attempts:[],assessments:[],events:[],announcements:[]});
    state.selectedClass=null; return;
  }
  const results = await Promise.all([
    supabase.from('class_members').select('class_id,student_id,joined_at,profiles!class_members_student_id_fkey(display_name)').in('class_id',ids),
    supabase.from('story_assignments').select('id,class_id,story_id,due_at,instructions,assigned_at').in('class_id',ids),
    supabase.from('scene_progress').select('class_id,student_id,story_id,scenes_completed,updated_at').in('class_id',ids),
    supabase.from('quiz_attempts').select('class_id,student_id,story_id,score,total,completed_at').in('class_id',ids).order('completed_at',{ascending:false}),
    supabase.from('assessment_scores').select('class_id,student_id,phase,score,max_score,updated_at').in('class_id',ids),
    supabase.from('class_events').select('id,class_id,title,description,starts_at,ends_at').in('class_id',ids).order('starts_at',{ascending:true}),
    supabase.from('class_announcements').select('id,class_id,title,body,created_at').in('class_id',ids).order('created_at',{ascending:false})
  ]);
  const errors = results.filter(r=>r.error);
  if (errors.length) throw errors[0].error;
  [state.members,state.assignments,state.scenes,state.attempts,state.assessments,state.events,state.announcements] = results.map(r=>r.data||[]);
  if (!state.classes.some(c=>c.id===state.selectedClass)) state.selectedClass=state.classes[0]?.id||null;
}

async function loadStudentData() {
  const {data:memberships,error} = await supabase.from('class_members').select('class_id,joined_at').eq('student_id',state.user.id).order('joined_at',{ascending:false});
  if (error) throw error;
  const ids = (memberships||[]).map(m=>m.class_id);
  if (!ids.length) {
    Object.assign(state,{classes:[],assignments:[],scenes:[],attempts:[],events:[],announcements:[],checklist:[]});
    return;
  }
  const results = await Promise.all([
    supabase.from('classrooms').select('id,name,grade_level,created_at').in('id',ids),
    supabase.from('story_assignments').select('id,class_id,story_id,due_at,instructions,assigned_at').in('class_id',ids),
    supabase.from('scene_progress').select('class_id,story_id,scenes_completed,updated_at').eq('student_id',state.user.id),
    supabase.from('quiz_attempts').select('class_id,story_id,score,total,completed_at').eq('student_id',state.user.id).order('completed_at',{ascending:false}),
    supabase.from('class_events').select('id,class_id,title,description,starts_at,ends_at').in('class_id',ids).order('starts_at',{ascending:true}),
    supabase.from('class_announcements').select('id,class_id,title,body,created_at').in('class_id',ids).order('created_at',{ascending:false}),
    supabase.from('student_checklist').select('id,title,category,due_date,is_done,created_at').eq('student_id',state.user.id).order('due_date',{ascending:true,nullsFirst:false})
  ]);
  const errors=results.filter(r=>r.error);
  if(errors.length) throw errors[0].error;
  [state.classes,state.assignments,state.scenes,state.attempts,state.events,state.announcements,state.checklist] = results.map(r=>r.data||[]);
}

async function tryPendingJoin() {
  if (isTeacher) return;
  const code = state.pendingCode || localStorage.getItem('storyverse-pending-join-v1');
  if (!code) return;
  const normalized=String(code).toUpperCase().replace(/[^A-Z0-9]/g,'');
  if (!normalized) return;
  const {data,error}=await supabase.rpc('join_storyverse_class',{p_code:normalized});
  if (error) {
    message('#dashMessage',`You are signed in, but the classroom code could not be used: ${error.message}`,'error');
    return;
  }
  localStorage.removeItem('storyverse-pending-join-v1');
  state.pendingCode='';
  history.replaceState({},'',location.pathname);
  message('#dashMessage',`You joined ${(Array.isArray(data)?data[0]:data)?.class_name || 'the classroom'}! Your teacher's assignments will appear below.`);
  await loadStudentData();
}
async function joinFromDashboard(event) {
  event.preventDefault();
  const input=$('#joinCodeInput'); const btn=$('#joinCodeForm button[type="submit"]');
  const code=input.value.trim().toUpperCase();
  if(!/^[A-Z0-9]{5,10}$/.test(code)) return message('#dashMessage','Enter the 5–10 character code from your teacher.','error');
  busy(btn,true,'JOINING…');
  try {
    const {data,error}=await supabase.rpc('join_storyverse_class',{p_code:code});
    if(error) throw error;
    const joined=Array.isArray(data)?data[0]:data;
    input.value=''; await loadStudentData(); renderView('dashboard');
    message('#dashMessage',`You're in! You joined ${joined.class_name}.`);
  } catch(error) { message('#dashMessage',error.message||'Could not join this classroom.','error'); }
  finally { busy(btn,false); }
}

function classOptions(selected=state.selectedClass) {
  return state.classes.map(c=>`<option value="${esc(c.id)}" ${c.id===selected?'selected':''}>${esc(c.name)} · ${esc(c.grade_level)}</option>`).join('');
}
function getClass(id) { return state.classes.find(c=>c.id===id); }
function classLabel(id) { const c=getClass(id); return c?`${c.name} · ${c.grade_level}`:'Classroom'; }
function storyById(id) { return state.stories.find(s=>s.id===id); }
function studentsIn(classId) { return state.members.filter(m=>!classId||m.class_id===classId); }
function assignedFor(classId) { return state.assignments.filter(a=>a.class_id===classId); }
function selectedClassControl() { return `<select class="control-input class-selector" id="activeClassSelect" aria-label="Select classroom">${classOptions()}</select>`; }
function attachClassSelector() {
  $('#activeClassSelect')?.addEventListener('change',e=>{state.selectedClass=e.target.value;renderView(state.view);});
}

function renderTeacherOverview() {
  const uniqueStudents=new Set(state.members.map(m=>m.student_id)).size;
  const upcoming=state.events.filter(e=>new Date(e.starts_at)>=new Date()).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at)).slice(0,4);
  const recent=state.attempts.slice(0,5);
  return `${viewHeading('YOUR TEACHER WORKSPACE','Your classrooms, <em>at a glance.</em>','Manage classes and see how your students are moving through each story.')}
    <div class="stats-grid">${stat('CLASSROOMS',state.classes.length,'Your active learning spaces')}${stat('STUDENTS',uniqueStudents,'Across your classrooms')}${stat('STORY ASSIGNMENTS',state.assignments.length,'Assigned reading adventures')}${stat('QUIZ ATTEMPTS',state.attempts.length,'Recorded classroom attempts')}</div>
    <div class="two-col"><section class="content-card"><h3>My classrooms</h3>${state.classes.length?`<div class="stack">${state.classes.slice(0,5).map(c=>`<div class="row-item"><div><strong>${esc(c.name)}</strong><small>${esc(c.grade_level)} · ${studentsIn(c.id).length} student(s)</small></div><button class="small-button" data-open-class="${esc(c.id)}">Open →</button></div>`).join('')}</div>`:empty('Create your first classroom to get started.')}</section>
    <section class="content-card"><h3>Upcoming class schedule</h3>${upcoming.length?`<div class="stack">${upcoming.map(e=>`<div class="row-item"><div><strong>${esc(e.title)}</strong><small>${esc(classLabel(e.class_id))}<br>${esc(fmtDateTime(e.starts_at))}</small></div><span class="pill">EVENT</span></div>`).join('')}</div>`:empty('No upcoming events. Add a class session in Class Schedule.')}</section></div>
    <section class="content-card"><h3>Recent quiz activity</h3>${recent.length?`<div class="data-table-wrap"><table class="data-table"><thead><tr><th>STUDENT</th><th>CLASS</th><th>STORY</th><th>RESULT</th><th>DATE</th></tr></thead><tbody>${recent.map(a=>{const m=state.members.find(x=>x.student_id===a.student_id&&x.class_id===a.class_id);const story=storyById(a.story_id);return `<tr><td>${esc(m?.profiles?.display_name||'Student')}</td><td>${esc(getClass(a.class_id)?.name||'Class')}</td><td>${esc(story?.title||a.story_id)}</td><td><span class="pill green">${Math.round(a.score/a.total*100)}%</span></td><td>${esc(fmtDate(a.completed_at))}</td></tr>`;}).join('')}</tbody></table></div>`:empty('Quiz submissions will show here when students complete assigned stories.')}</section>`;
}
function renderTeacherClassrooms() {
  const selected=getClass(state.selectedClass);
  const members=studentsIn(state.selectedClass);
  const assignments=selected?assignedFor(selected.id):[];
  const invite=selected?`${location.origin}${location.pathname.replace(/[^/]*$/,'')}student.html?code=${selected.class_code}`:'';
  return `${viewHeading('CLASSROOM MANAGEMENT','Build your <em>learning spaces.</em>','Create a classroom and share its private join code with students.')}
    <section class="content-card"><h3>Create a classroom</h3><form id="createClassForm" class="form-grid"><div class="form-field compact"><label for="newClassName">CLASS NAME</label><input id="newClassName" maxlength="80" required placeholder="e.g. Grade 7 · Section A"></div><div class="form-field compact"><label for="newClassGrade">GRADE LEVEL</label><select id="newClassGrade"><option>Grade 7</option><option>Grade 8</option><option>Grade 9</option><option>Other</option></select></div><div class="full"><button class="small-button primary" type="submit">＋ Create classroom</button></div></form></section>
    ${state.classes.length?`<div class="class-grid">${state.classes.map(c=>`<button class="class-tile ${c.id===state.selectedClass?'selected':''}" type="button" data-select-class="${esc(c.id)}"><span class="pill purple">${esc(c.grade_level)}</span><strong>${esc(c.name)}</strong><small class="muted">${studentsIn(c.id).length} student(s) · ${assignedFor(c.id).length} assigned story(s)</small><div class="class-code">${esc(c.class_code)}</div></button>`).join('')}</div>`:empty('No classrooms yet. Create one above.')}
    ${selected?`<section class="content-card"><div class="view-heading"><div><div class="view-kicker">SELECTED CLASSROOM</div><h2>${esc(selected.name)}</h2><p>${esc(selected.grade_level)} · ${members.length} enrolled student(s)</p></div><div class="action-row"><span class="class-code">${esc(selected.class_code)}</span><button class="small-button" id="copyInvite">Copy invite link</button></div></div><p class="notice-inline">Share this code privately. Students can self-register, enter the code, and join this class. Invite link: <code>${esc(invite)}</code></p><div class="action-row"><button class="small-button" data-go-view="students">View students</button><button class="small-button" data-go-view="assignments">Manage assignments</button></div></section>`:''}`;
}
function renderTeacherStudents() {
  const members=studentsIn(state.selectedClass);
  const rows=members.map(m=>{
    const scenes=state.scenes.filter(s=>s.class_id===m.class_id&&s.student_id===m.student_id).reduce((n,s)=>n+Number(s.scenes_completed||0),0);
    const quizzes=state.attempts.filter(a=>a.class_id===m.class_id&&a.student_id===m.student_id);
    const avg=quizzes.length?Math.round(quizzes.reduce((n,a)=>n+a.score/a.total*100,0)/quizzes.length):null;
    return `<tr><td><strong>${esc(m.profiles?.display_name||'Student')}</strong><small>${esc(m.student_id.slice(0,8))} · Joined ${esc(fmtDate(m.joined_at))}</small></td><td>${esc(getClass(m.class_id)?.name||'')}</td><td>${scenes} scene(s)</td><td>${avg===null?'—':`${avg}%`}<small>${quizzes.length} quiz attempt(s)</small></td></tr>`;
  }).join('');
  return `${viewHeading('LEARNER ROSTER','Meet your <em>students.</em>','The roster only includes students in your own classrooms.',selectedClassControl())}<section class="content-card">${rows?`<div class="data-table-wrap"><table class="data-table"><thead><tr><th>STUDENT</th><th>CLASSROOM</th><th>SCENES COMPLETED</th><th>STORY QUIZ AVG.</th></tr></thead><tbody>${rows}</tbody></table></div>`:empty(state.classes.length?'No students have joined this classroom yet. Share its join code.':'Create a classroom first.')}</section>`;
}
function renderTeacherAssignments() {
  const selected=getClass(state.selectedClass);
  if(!selected) return `${viewHeading('READING TASKS','Story <em>assignments.</em>','Create a classroom first, then assign stories to it.')}${empty('Create your first classroom in My Classrooms.')}`;
  const rows=state.stories.map(story=>{
    const assignment=state.assignments.find(a=>a.class_id===selected.id&&a.story_id===story.id);
    return `<article class="story-tile"><div class="tile-meta">${esc(story.readingLevel||story.genre||'STORY')}</div><div class="story-emoji">${story.world==='web'?'🕷️':story.world==='forest'?'🌲':'🐢'}</div><h3>${esc(story.title)}</h3><p>${esc(story.description)}</p><label class="check-row"><input type="checkbox" data-assignment-toggle="${esc(story.id)}" ${assignment?'checked':''}><span class="check-copy"><strong>${assignment?'Assigned to class':'Assign this story'}</strong><small>Students will see it in My Stories.</small></span></label><div class="form-field compact"><label>DEADLINE (OPTIONAL)</label><input type="date" data-assignment-due="${esc(story.id)}" value="${assignment?.due_at?new Date(assignment.due_at).toISOString().slice(0,10):''}"></div><div class="form-field compact"><label>TEACHER INSTRUCTIONS</label><textarea rows="2" data-assignment-instructions="${esc(story.id)}" placeholder="What should students focus on?">${esc(assignment?.instructions||'')}</textarea></div><button class="small-button" data-save-assignment="${esc(story.id)}">Save assignment details</button></article>`;
  }).join('');
  return `${viewHeading('READING TASKS','Assign a story <em>adventure.</em>','Choose a classroom, select reading adventures, and set instructions or deadlines.',selectedClassControl())}<div class="content-card"><h3>${esc(selected.name)} · ${selected.grade_level}</h3><p class="card-subtitle">Tick a story to assign it. Set a due date and instructions, then save the details.</p><div class="story-grid">${rows||empty('Story catalogue not available.')}</div></div>`;
}
function renderTeacherProgress() {
  const members=studentsIn(state.selectedClass);
  const assigned=assignedFor(state.selectedClass);
  const totalPossible=Math.max(1,assigned.length*3);
  const rows=members.map(m=>{
    const sceneCount=state.scenes.filter(s=>s.class_id===m.class_id&&s.student_id===m.student_id).reduce((n,s)=>n+Number(s.scenes_completed||0),0);
    const quizzes=state.attempts.filter(a=>a.class_id===m.class_id&&a.student_id===m.student_id);
    const avg=quizzes.length?Math.round(quizzes.reduce((n,a)=>n+a.score/a.total*100,0)/quizzes.length):null;
    return `<tr><td><strong>${esc(m.profiles?.display_name||'Student')}</strong><small>${esc(m.student_id.slice(0,8))}</small></td><td>${sceneCount}/${totalPossible}<div class="progress-track"><span style="width:${Math.min(100,sceneCount/totalPossible*100)}%"></span></div></td><td>${avg===null?'—':`${avg}%`}</td><td>${quizzes.length}</td><td>${esc(fmtDate(state.scenes.filter(s=>s.student_id===m.student_id&&s.class_id===m.class_id).sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at))[0]?.updated_at))}</td></tr>`;
  }).join('');
  return `${viewHeading('READING & COMPREHENSION','Student <em>progress.</em>','Review scene completion and class quiz results. Scene completion records navigation, not proof of reading attention.',selectedClassControl())}<section class="content-card">${rows?`<div class="data-table-wrap"><table class="data-table"><thead><tr><th>STUDENT</th><th>SCENE COMPLETION</th><th>QUIZ AVG.</th><th>ATTEMPTS</th><th>LAST ACTIVITY</th></tr></thead><tbody>${rows}</tbody></table></div>`:empty('No student progress yet. Assign a story and invite students to your class.')}</section>`;
}
function renderTeacherAssessments() {
  const members=studentsIn(state.selectedClass);
  const rows=members.map(m=>{
    const pre=state.assessments.find(a=>a.class_id===m.class_id&&a.student_id===m.student_id&&a.phase==='pre');
    const post=state.assessments.find(a=>a.class_id===m.class_id&&a.student_id===m.student_id&&a.phase==='post');
    const preP=pre?Number(pre.score)/Number(pre.max_score)*100:null;
    const postP=post?Number(post.score)/Number(post.max_score)*100:null;
    const diff=preP!==null&&postP!==null?postP-preP:null;
    return `<tr><td><strong>${esc(m.profiles?.display_name||'Student')}</strong><small>${esc(m.student_id.slice(0,8))}</small></td><td><input type="number" min="0" max="100" step="0.1" data-pre="${esc(m.student_id)}" value="${preP===null?'':preP.toFixed(1)}" placeholder="0–100"></td><td><input type="number" min="0" max="100" step="0.1" data-post="${esc(m.student_id)}" value="${postP===null?'':postP.toFixed(1)}" placeholder="0–100"></td><td>${diff===null?'—':`${diff>0?'+':''}${diff.toFixed(1)} pp`}</td><td><button class="small-button" data-save-assessment="${esc(m.student_id)}">Save</button></td></tr>`;
  }).join('');
  return `${viewHeading('RESEARCH RECORDS','Research <em>assessments.</em>','Enter pre-test and post-test percentages from the same approved assessment. Quiz scores are separate from research test scores.',selectedClassControl())}<section class="content-card"><p class="card-subtitle">Scores are visible to you as the classroom teacher. Use a consistent assessment and scoring scale.</p>${rows?`<div class="data-table-wrap"><table class="data-table"><thead><tr><th>STUDENT</th><th>PRE-TEST %</th><th>POST-TEST %</th><th>CHANGE</th><th>ACTION</th></tr></thead><tbody>${rows}</tbody></table></div>`:empty('Join students to this classroom before recording scores.')}</section>`;
}
function renderTeacherSchedule() {
  const events=[...state.events].sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
  return `${viewHeading('PLAN AHEAD','Class <em>schedule.</em>','Add reading sessions, class meetings, or study activities.')}
    <section class="content-card"><h3>Add a class event</h3>${state.classes.length?`<form id="eventForm" class="form-grid"><div class="form-field compact"><label>CLASSROOM</label><select name="class_id" required>${classOptions(null)}</select></div><div class="form-field compact"><label>EVENT TITLE</label><input name="title" maxlength="100" required placeholder="e.g. Reading workshop"></div><div class="form-field compact"><label>STARTS</label><input name="starts_at" type="datetime-local" required></div><div class="form-field compact"><label>ENDS (OPTIONAL)</label><input name="ends_at" type="datetime-local"></div><div class="form-field compact full"><label>DETAILS</label><textarea name="description" rows="2" maxlength="1000" placeholder="What should students prepare?"></textarea></div><div class="full"><button class="small-button primary" type="submit">＋ Add to schedule</button></div></form>`:empty('Create a classroom before adding class events.')}</section>
    <section class="content-card"><h3>Upcoming and previous events</h3>${events.length?`<div class="stack">${events.map(e=>`<div class="row-item"><div><strong>${esc(e.title)}</strong><small>${esc(classLabel(e.class_id))} · ${esc(fmtDateTime(e.starts_at))}${e.description?`<br>${esc(e.description)}`:''}</small></div><button class="small-button danger" data-delete-event="${esc(e.id)}">Remove</button></div>`).join('')}</div>`:empty('No events have been added yet.')}</section>`;
}
function renderTeacherAnnouncements() {
  return `${viewHeading('KEEP EVERYONE IN THE LOOP','Class <em>announcements.</em>','Post reminders and updates for students in your classrooms.')}
    <section class="content-card"><h3>Post an announcement</h3>${state.classes.length?`<form id="announcementForm" class="form-grid"><div class="form-field compact"><label>CLASSROOM</label><select name="class_id" required>${classOptions(null)}</select></div><div class="form-field compact"><label>ANNOUNCEMENT TITLE</label><input name="title" maxlength="100" required placeholder="e.g. Quiz reminder"></div><div class="form-field compact full"><label>MESSAGE</label><textarea name="body" rows="3" maxlength="2000" required placeholder="Write your message for the class…"></textarea></div><div class="full"><button class="small-button primary" type="submit">Publish announcement</button></div></form>`:empty('Create a classroom before posting announcements.')}</section>
    <section class="content-card"><h3>Published announcements</h3>${state.announcements.length?`<div class="stack">${state.announcements.map(a=>`<article class="announcement-card"><div class="row-item"><strong>${esc(a.title)}</strong><button class="small-button danger" data-delete-announcement="${esc(a.id)}">Delete</button></div><p>${esc(a.body)}</p><small>${esc(classLabel(a.class_id))} · ${esc(fmtDate(a.created_at))}</small></article>`).join('')}</div>`:empty('Your classroom announcements will appear here.')}</section>`;
}
function renderTeacherSettings() {
  return `${viewHeading('ACCOUNT','Your <em>settings.</em>','Account and access information.')}
    <section class="content-card"><div class="profile-key">DISPLAY NAME</div><div class="profile-value">${esc(state.profile.display_name||'Teacher')}</div><div class="profile-key">EMAIL</div><div class="profile-value">${esc(state.user.email||'')}</div><div class="profile-key">ACCOUNT ROLE</div><div class="profile-value"><span class="pill purple">Approved teacher</span></div><p class="notice-inline">Teacher access is approved by the project administrator. Never share your password or Supabase project settings.</p><a class="small-button" href="stories.html">Open story library ↗</a></section>`;
}

function renderStudentJoinForm() {
  return `<section class="content-card"><div class="view-heading"><div><div class="view-kicker">JOIN YOUR CLASS</div><h2>Have a classroom code?</h2><p>Enter the private code shared by your teacher.</p></div></div><form id="joinCodeForm" class="inline-form"><div class="form-field compact"><label>CLASSROOM CODE</label><input id="joinCodeInput" class="control-input" maxlength="10" required value="${esc(state.pendingCode)}" placeholder="ENTER CODE"></div><button class="small-button primary" type="submit">Join classroom →</button></form></section>`;
}
function studentOverview() {
  const pending=state.assignments.filter(a=>!state.attempts.some(q=>q.class_id===a.class_id&&q.story_id===a.story_id));
  const completed=new Set(state.scenes.filter(s=>s.scenes_completed>=3).map(s=>`${s.class_id}:${s.story_id}`)).size;
  const avg=state.attempts.length?Math.round(state.attempts.reduce((n,a)=>n+a.score/a.total*100,0)/state.attempts.length):null;
  const due=state.assignments.filter(a=>a.due_at&&new Date(a.due_at)>=new Date()).sort((a,b)=>new Date(a.due_at)-new Date(b.due_at)).slice(0,4);
  const upcoming=state.events.filter(e=>new Date(e.starts_at)>=new Date()).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at)).slice(0,3);
  return `${viewHeading('YOUR STUDENT SPACE','Your adventures, <em>at a glance.</em>','Pick up where you left off and keep an eye on what is coming up.')}
    <div class="stats-grid">${stat('MY CLASSROOMS',state.classes.length,'Classes you have joined')}${stat('ASSIGNED STORIES',state.assignments.length,'Reading adventures to explore')}${stat('COMPLETED STORIES',completed,'Stories with all three scenes read')}${stat('QUIZ AVERAGE',avg===null?'—':`${avg}%`,'Based on submitted class quizzes')}</div>
    ${renderStudentJoinForm()}
    <div class="two-col"><section class="content-card"><h3>Coming up</h3>${due.length?`<div class="stack">${due.map(a=>{const story=storyById(a.story_id);return `<div class="row-item"><div><strong>${esc(story?.title||a.story_id)}</strong><small>${esc(classLabel(a.class_id))}</small></div><span class="pill pink">Due ${esc(fmtDate(a.due_at))}</span></div>`;}).join('')}</div>`:empty('No upcoming story deadlines. Check My Tasks for your assignments.')}</section>
    <section class="content-card"><h3>Next on your schedule</h3>${upcoming.length?`<div class="stack">${upcoming.map(e=>`<div class="row-item"><div><strong>${esc(e.title)}</strong><small>${esc(classLabel(e.class_id))}</small></div><span class="schedule-date">${esc(fmtDateTime(e.starts_at))}</span></div>`).join('')}</div>`:empty('No class events have been scheduled yet.')}</section></div>
    <section class="content-card"><h3>Start reading</h3>${state.assignments.length?`<div class="story-grid">${state.assignments.slice(0,3).map(studentStoryTile).join('')}</div>`:empty(state.classes.length?'Your teacher has not assigned a story yet. Check back soon.':'Join a classroom using the code from your teacher to see assigned stories.')}</section>`;
}
function studentStoryTile(assignment) {
  const story=storyById(assignment.story_id); if(!story) return '';
  const progress=state.scenes.find(s=>s.class_id===assignment.class_id&&s.story_id===assignment.story_id);
  const count=Number(progress?.scenes_completed||0);
  const attempt=state.attempts.find(a=>a.class_id===assignment.class_id&&a.story_id===assignment.story_id);
  const link=`stories.html?class=${encodeURIComponent(assignment.class_id)}&story=${encodeURIComponent(assignment.story_id)}`;
  return `<article class="story-tile"><div class="tile-meta">${esc(story.readingLevel||story.genre||'STORY')}</div><div class="story-emoji">${story.world==='web'?'🕷️':story.world==='forest'?'🌲':'🐢'}</div><h3>${esc(story.title)}</h3><p>${esc(assignment.instructions||story.description)}</p><div class="progress-track"><span style="width:${Math.min(100,count/3*100)}%"></span></div><div class="row-item"><small>${count}/3 scenes · ${attempt?`${attempt.score}/${attempt.total} quiz`: 'Quiz not submitted'}</small>${assignment.due_at?`<small>Due ${esc(fmtDate(assignment.due_at))}</small>`:''}</div><a class="small-button primary" href="${link}">Open story ↗</a></article>`;
}
function renderStudentStories() {
  return `${viewHeading('YOUR ASSIGNED READING','My <em>stories.</em>','These are the story adventures your teachers assigned to your classrooms.')}
    ${state.assignments.length?`<div class="story-grid">${state.assignments.map(studentStoryTile).join('')}</div>`:empty(state.classes.length?'No stories have been assigned yet.':'Join your teacher’s classroom to see your assigned stories.')}`;
}
function renderStudentTasks() {
  const tasks=state.assignments.map(a=>{
    const story=storyById(a.story_id);const attempt=state.attempts.find(q=>q.class_id===a.class_id&&q.story_id===a.story_id);
    const prog=state.scenes.find(s=>s.class_id===a.class_id&&s.story_id===a.story_id);const done=!!attempt;
    return `<article class="student-task-card"><div><span class="pill ${done?'green':'purple'}">${done?'QUIZ SUBMITTED':'READING TASK'}</span><h3>${esc(story?.title||a.story_id)}</h3><p>${esc(a.instructions||'Read the assigned story and complete its comprehension quiz.')}</p><small class="muted">${esc(classLabel(a.class_id))} · ${Number(prog?.scenes_completed||0)}/3 scenes · ${a.due_at?`Due ${esc(fmtDate(a.due_at))}`:'No deadline'}</small></div><a class="small-button ${done?'':'primary'}" href="stories.html?class=${encodeURIComponent(a.class_id)}&story=${encodeURIComponent(a.story_id)}">${done?'Review':'Start task'} ↗</a></article>`;
  }).join('');
  return `${viewHeading('WHAT YOU NEED TO DO','My <em>tasks.</em>','Your teacher’s assigned reading and comprehension activities.')}${tasks?`<div class="stack">${tasks}</div>`:empty('No tasks yet. Your teacher’s assignments will appear here.')}`;
}
function renderStudentSchedule() {
  const items=[];
  state.assignments.filter(a=>a.due_at).forEach(a=>{const s=storyById(a.story_id);items.push({date:a.due_at,title:`Due: ${s?.title||a.story_id}`,detail:classLabel(a.class_id),kind:'ASSIGNMENT'});});
  state.events.forEach(e=>items.push({date:e.starts_at,title:e.title,detail:`${classLabel(e.class_id)}${e.description?` · ${e.description}`:''}`,kind:'CLASS EVENT'}));
  items.sort((a,b)=>new Date(a.date)-new Date(b.date));
  return `${viewHeading('DATES TO REMEMBER','My <em>schedule.</em>','Class events and assignment deadlines shared by your teachers.')}
    <section class="content-card">${items.length?`<div class="stack">${items.map(i=>`<div class="row-item"><div class="date-badge"><b>${new Date(i.date).getDate()}</b><span>${new Date(i.date).toLocaleDateString(undefined,{month:'short'}).toUpperCase()}</span></div><div style="flex:1"><strong>${esc(i.title)}</strong><small>${esc(i.detail)}</small></div><span class="pill">${i.kind}</span></div>`).join('')}</div>`:empty('Nothing scheduled yet. Your teacher’s class events and task deadlines will appear here.')}</section>`;
}
function renderStudentChecklist() {
  const items=state.checklist;
  return `${viewHeading('YOUR PRIVATE SPACE','My <em>checklist.</em>','Keep school tasks and personal chores together. Only you can see the items in this checklist.')}
    <section class="content-card"><h3>Add a task</h3><form id="checklistForm" class="form-grid"><div class="form-field compact"><label>TASK OR CHORE</label><input name="title" maxlength="140" required placeholder="e.g. Review vocabulary"></div><div class="form-field compact"><label>TYPE</label><select name="category"><option value="school">School task</option><option value="personal">Personal chore</option></select></div><div class="form-field compact"><label>DUE DATE (OPTIONAL)</label><input name="due_date" type="date" min="${todayISO()}"></div><div class="full"><button class="small-button primary" type="submit">＋ Add to my checklist</button></div></form></section>
    <section class="content-card"><div class="view-heading"><div><h2>My things to do</h2><p>${items.filter(i=>!i.is_done).length} remaining · ${items.filter(i=>i.is_done).length} completed</p></div></div>${items.length?`<div class="stack">${items.map(i=>`<div class="check-row ${i.is_done?'done':''}"><input type="checkbox" data-check-toggle="${esc(i.id)}" ${i.is_done?'checked':''} aria-label="Mark ${esc(i.title)} complete"><span class="check-copy"><strong>${esc(i.title)}</strong><small>${i.category==='personal'?'Personal chore':'School task'}${i.due_date?` · Due ${esc(fmtDate(i.due_date))}`:''}</small></span><button class="small-button danger" data-check-delete="${esc(i.id)}">Delete</button></div>`).join('')}</div>`:empty('Your checklist is clear. Add a school task or personal chore above.')}</section>`;
}
function renderStudentProgress() {
  const completed=state.scenes.filter(s=>s.scenes_completed>=3).length;
  const avg=state.attempts.length?Math.round(state.attempts.reduce((n,a)=>n+a.score/a.total*100,0)/state.attempts.length):null;
  return `${viewHeading('YOUR READING JOURNEY','My <em>progress.</em>','Only you can see your personal reading and quiz results.')}
    <div class="stats-grid">${stat('ASSIGNED STORIES',state.assignments.length,'From your classrooms')}${stat('COMPLETED STORIES',completed,'All 3 scenes completed')}${stat('QUIZ ATTEMPTS',state.attempts.length,'Submitted class quizzes')}${stat('QUIZ AVERAGE',avg===null?'—':`${avg}%`,'Across your submitted quizzes')}</div>
    <section class="content-card"><h3>Reading progress</h3>${state.assignments.length?`<div class="stack">${state.assignments.map(a=>{const s=storyById(a.story_id);const p=state.scenes.find(x=>x.class_id===a.class_id&&x.story_id===a.story_id);const count=Number(p?.scenes_completed||0);return `<div class="row-item"><div style="flex:1"><strong>${esc(s?.title||a.story_id)}</strong><small>${esc(classLabel(a.class_id))}</small><div class="progress-track"><span style="width:${count/3*100}%"></span></div></div><span class="pill">${count}/3 scenes</span></div>`;}).join('')}</div>`:empty('Join a classroom and your reading progress will show here.')}</section>
    <section class="content-card"><h3>Quiz results</h3>${state.attempts.length?`<div class="stack">${state.attempts.map(a=>`<div class="row-item"><div><strong>${esc(storyById(a.story_id)?.title||a.story_id)}</strong><small>${esc(classLabel(a.class_id))} · ${esc(fmtDate(a.completed_at))}</small></div><span class="pill green">${a.score}/${a.total} · ${Math.round(a.score/a.total*100)}%</span></div>`).join('')}</div>`:empty('Your quiz results will appear here when you submit an assigned story quiz.')}</section>`;
}
function renderStudentAnnouncements() {
  return `${viewHeading('FROM YOUR CLASSROOMS','Announcements <em>for you.</em>','Updates and reminders posted by your teachers.')}${state.announcements.length?`<div class="stack">${state.announcements.map(a=>`<article class="announcement-card"><strong>${esc(a.title)}</strong><p>${esc(a.body)}</p><small>${esc(classLabel(a.class_id))} · ${esc(fmtDateTime(a.created_at))}</small></article>`).join('')}</div>`:empty('No announcements yet.')}`;
}
function renderStudentProfile() {
  const avg=state.attempts.length?Math.round(state.attempts.reduce((n,a)=>n+a.score/a.total*100,0)/state.attempts.length):0;
  const completed=state.scenes.filter(s=>s.scenes_completed>=3).length;
  const unlocked=state.attempts.length>=3 || completed>=2;
  const color=state.profile.profile_color||'#8879df';
  const theme=state.profile.profile_theme||'dreamy';
  return `${viewHeading('YOUR ACCOUNT','My <em>profile.</em>','Make your reader profile feel like yours. Earn new looks as you explore.')}
    <section class="content-card profile-custom-card"><div class="profile-preview" style="--profile-accent:${esc(color)}"><div class="profile-avatar">${theme==='cosmic'?'🌙':theme==='nature'?'🌿':theme==='pixel'?'🎮':'✨'}</div><div><strong>${esc(state.profile.display_name||'Story Explorer')}</strong><small>STORYVERSE READER · ${completed} stories completed</small><span class="profile-badge">${unlocked?'✦ Adventure collector':'✧ Curious explorer'}</span></div></div>
    <form id="profileForm" class="profile-settings-grid"><div class="form-field compact"><label>DISPLAY NAME OR STUDY CODE</label><input class="control-input" name="display_name" maxlength="40" required value="${esc(state.profile.display_name||'')}" /></div><div class="form-field compact"><label>PROFILE COLOR</label><input class="control-input color-input" name="profile_color" type="color" value="${esc(color)}" /></div><div class="form-field compact"><label>PROFILE DESIGN</label><select class="control-input" name="profile_theme"><option value="dreamy" ${theme==='dreamy'?'selected':''}>Dreamy pastel ✨</option><option value="nature" ${theme==='nature'?'selected':''}>Nature explorer 🌿</option><option value="cosmic" ${theme==='cosmic'?'selected':''} ${!unlocked?'disabled':''}>Cosmic night ${!unlocked?'🔒 — unlock at 3 quizzes or 2 stories':'🌙'}</option><option value="pixel" ${theme==='pixel'?'selected':''} ${state.attempts.length<5?'disabled':''}>Pixel gamer ${state.attempts.length<5?'🔒 — unlock at 5 quizzes':'🎮'}</option></select></div><label class="privacy-toggle"><input type="checkbox" name="scores_public" ${state.profile.scores_public?'checked':''}> Show my scores on my profile (visible only to me)</label><div class="full"><button class="small-button primary" type="submit">Save my profile ✦</button></div></form>
    ${state.profile.scores_public?`<div class="profile-score-row"><div><small>QUIZ AVERAGE</small><strong>${state.attempts.length?avg+'%':'—'}</strong></div><div><small>QUIZZES TAKEN</small><strong>${state.attempts.length}</strong></div><div><small>STORIES FINISHED</small><strong>${completed}</strong></div></div><div class="stack profile-score-list">${state.attempts.map(a=>`<div class="row-item"><span>${esc(storyById(a.story_id)?.title||a.story_id)}</span><strong>${a.score}/${a.total} · ${Math.round(a.score/a.total*100)}%</strong></div>`).join('')}</div>`:''}
    <p class="notice-inline">Your score summary is private and hidden from your profile by default. Turn it on to display it in your own profile tab. This does not publish your scores to other students. Your teacher can still see class learning records.</p></section>`;
}

function renderView(view) {
  state.view=view;
  $$('#sideNav [data-view]').forEach(btn=>btn.classList.toggle('is-active',btn.dataset.view===view));
  const renderers=isTeacher?{
    dashboard:renderTeacherOverview,classrooms:renderTeacherClassrooms,students:renderTeacherStudents,
    assignments:renderTeacherAssignments,progress:renderTeacherProgress,assessments:renderTeacherAssessments,
    schedule:renderTeacherSchedule,announcements:renderTeacherAnnouncements,settings:renderTeacherSettings
  }:{
    dashboard:studentOverview,stories:renderStudentStories,tasks:renderStudentTasks,schedule:renderStudentSchedule,
    checklist:renderStudentChecklist,progress:renderStudentProgress,announcements:renderStudentAnnouncements,profile:renderStudentProfile
  };
  $('#viewRoot').innerHTML=(renderers[view]||renderers.dashboard)();
  attachClassSelector();
  attachViewEvents();
}

function attachViewEvents() {
  $('#createClassForm')?.addEventListener('submit',createClass);
  $('#copyInvite')?.addEventListener('click',copyInvite);
  $$('[data-open-class]').forEach(btn=>btn.addEventListener('click',()=>{state.selectedClass=btn.dataset.openClass;renderView('classrooms');}));
  $$('[data-select-class]').forEach(btn=>btn.addEventListener('click',()=>{state.selectedClass=btn.dataset.selectClass;renderView('classrooms');}));
  $$('[data-go-view]').forEach(btn=>btn.addEventListener('click',()=>renderView(btn.dataset.goView)));
  $$('[data-assignment-toggle]').forEach(input=>input.addEventListener('change',()=>toggleAssignment(input.dataset.assignmentToggle,input.checked)));
  $$('[data-save-assignment]').forEach(btn=>btn.addEventListener('click',()=>saveAssignmentDetails(btn.dataset.saveAssignment,btn)));
  $$('[data-save-assessment]').forEach(btn=>btn.addEventListener('click',()=>saveAssessment(btn.dataset.saveAssessment,btn)));
  $('#eventForm')?.addEventListener('submit',createEvent);
  $$('[data-delete-event]').forEach(btn=>btn.addEventListener('click',()=>deleteRow('class_events',btn.dataset.deleteEvent,'Event removed.')));
  $('#announcementForm')?.addEventListener('submit',createAnnouncement);
  $$('[data-delete-announcement]').forEach(btn=>btn.addEventListener('click',()=>deleteRow('class_announcements',btn.dataset.deleteAnnouncement,'Announcement deleted.')));
  $('#joinCodeForm')?.addEventListener('submit',joinFromDashboard);
  $('#checklistForm')?.addEventListener('submit',addChecklistItem);
  $$('[data-check-toggle]').forEach(input=>input.addEventListener('change',()=>toggleChecklist(input.dataset.checkToggle,input.checked)));
  $$('[data-check-delete]').forEach(btn=>btn.addEventListener('click',()=>deleteChecklistItem(btn.dataset.checkDelete)));
  $('#profileForm')?.addEventListener('submit',saveProfile);
}

async function createClass(event) {
  event.preventDefault(); const btn=$('#createClassForm button[type="submit"]'); busy(btn,true,'CREATING…');
  try {
    const {data,error}=await supabase.rpc('create_storyverse_class',{p_name:$('#newClassName').value.trim(),p_grade_level:$('#newClassGrade').value});
    if(error) throw error;
    const created=Array.isArray(data)?data[0]:data;
    state.selectedClass=created.class_id;
    await loadTeacherData(); renderView('classrooms');
    message('#dashMessage',`Classroom created. Share the private code ${created.class_code} with your students.`);
  } catch(error) { message('#dashMessage',error.message||'Could not create classroom.','error'); }
  finally { busy(btn,false); }
}
async function copyInvite() {
  const c=getClass(state.selectedClass); if(!c)return;
  const url=`${location.origin}${location.pathname.replace(/[^/]*$/,'')}student.html?code=${c.class_code}`;
  try { await navigator.clipboard.writeText(url); message('#dashMessage','Student invite link copied. Share it privately.'); }
  catch { message('#dashMessage',`Invite link: ${url}`); }
}
async function toggleAssignment(storyId,checked) {
  const c=state.selectedClass; if(!c)return;
  try {
    if(checked) {
      const {error}=await supabase.from('story_assignments').upsert({class_id:c,story_id:storyId},{onConflict:'class_id,story_id',ignoreDuplicates:true}); if(error)throw error;
    } else {
      const {error}=await supabase.from('story_assignments').delete().eq('class_id',c).eq('story_id',storyId); if(error)throw error;
    }
    await loadTeacherData(); renderView('assignments'); message('#dashMessage',checked?'Story assigned to the selected classroom.':'Story removed from the assignment list.');
  } catch(error) { message('#dashMessage',error.message||'Could not update the assignment. Run the portal upgrade SQL and try again.','error'); }
}
async function saveAssignmentDetails(storyId,button) {
  const due=$(`[data-assignment-due="${storyId}"]`)?.value;
  const instructions=$(`[data-assignment-instructions="${storyId}"]`)?.value.trim()||'';
  if(!assignedFor(state.selectedClass).some(a=>a.story_id===storyId)) return message('#dashMessage','Assign this story first, then save its deadline and instructions.','error');
  busy(button,true,'SAVING…');
  try {
    const dueAt=due?new Date(`${due}T23:59:00`).toISOString():null;
    const {error}=await supabase.from('story_assignments').update({due_at:dueAt,instructions}).eq('class_id',state.selectedClass).eq('story_id',storyId);
    if(error)throw error;
    await loadTeacherData(); renderView('assignments'); message('#dashMessage','Assignment deadline and instructions saved.');
  } catch(error) { message('#dashMessage',error.message||'Could not save assignment details.','error'); }
  finally { busy(button,false); }
}
async function saveAssessment(studentId,button) {
  const rows=[];
  for(const phase of ['pre','post']) {
    const raw=$(`[data-${phase}="${studentId}"]`)?.value.trim(); if(!raw)continue;
    const score=Number(raw); if(!Number.isFinite(score)||score<0||score>100)return message('#dashMessage','Enter assessment percentages from 0 to 100.','error');
    rows.push({class_id:state.selectedClass,student_id:studentId,phase,score,max_score:100,updated_at:new Date().toISOString()});
  }
  if(!rows.length)return message('#dashMessage','Enter a pre-test or post-test percentage before saving.','error');
  busy(button,true,'SAVING…');
  try { const {error}=await supabase.from('assessment_scores').upsert(rows,{onConflict:'class_id,student_id,phase'});if(error)throw error;await loadTeacherData();renderView('assessments');message('#dashMessage','Research assessment scores saved.'); }
  catch(error){message('#dashMessage',error.message||'Could not save scores.','error');}
  finally{busy(button,false);}
}
async function createEvent(event) {
  event.preventDefault();const form=event.currentTarget;const data=new FormData(form);const btn=form.querySelector('button[type="submit"]');busy(btn,true,'ADDING…');
  try {
    const row={class_id:data.get('class_id'),title:String(data.get('title')).trim(),description:String(data.get('description')||'').trim(),starts_at:new Date(data.get('starts_at')).toISOString(),ends_at:data.get('ends_at')?new Date(data.get('ends_at')).toISOString():null,created_by:state.user.id};
    const {error}=await supabase.from('class_events').insert(row);if(error)throw error;
    await loadTeacherData();renderView('schedule');message('#dashMessage','Class event added to the schedule.');
  } catch(error){message('#dashMessage',`${error.message||'Could not add event.'} Make sure the portal upgrade SQL has been run.`,'error');}
  finally{busy(btn,false);}
}
async function createAnnouncement(event) {
  event.preventDefault();const form=event.currentTarget;const data=new FormData(form);const btn=form.querySelector('button[type="submit"]');busy(btn,true,'PUBLISHING…');
  try {
    const {error}=await supabase.from('class_announcements').insert({class_id:data.get('class_id'),title:String(data.get('title')).trim(),body:String(data.get('body')).trim(),created_by:state.user.id});if(error)throw error;
    await loadTeacherData();renderView('announcements');message('#dashMessage','Announcement published to the selected classroom.');
  } catch(error){message('#dashMessage',`${error.message||'Could not publish announcement.'} Make sure the portal upgrade SQL has been run.`,'error');}
  finally{busy(btn,false);}
}
async function deleteRow(table,id,success) {
  try { const {error}=await supabase.from(table).delete().eq('id',id);if(error)throw error;await loadTeacherData();renderView(state.view);message('#dashMessage',success); }
  catch(error){message('#dashMessage',error.message||'Could not remove item.','error');}
}
async function addChecklistItem(event) {
  event.preventDefault();const form=event.currentTarget;const data=new FormData(form);const btn=form.querySelector('button[type="submit"]');busy(btn,true,'ADDING…');
  try {
    const {error}=await supabase.from('student_checklist').insert({student_id:state.user.id,title:String(data.get('title')).trim(),category:data.get('category'),due_date:data.get('due_date')||null});if(error)throw error;
    await loadStudentData();renderView('checklist');message('#dashMessage','Added to your private checklist.');
  } catch(error){message('#dashMessage',`${error.message||'Could not save checklist item.'} Make sure the portal upgrade SQL has been run.`,'error');}
  finally{busy(btn,false);}
}
async function toggleChecklist(id,isDone) {
  try {const {error}=await supabase.from('student_checklist').update({is_done:isDone,updated_at:new Date().toISOString()}).eq('id',id);if(error)throw error;await loadStudentData();renderView('checklist');}
  catch(error){message('#dashMessage',error.message||'Could not update checklist.','error');}
}
async function deleteChecklistItem(id) {
  try {const {error}=await supabase.from('student_checklist').delete().eq('id',id);if(error)throw error;await loadStudentData();renderView('checklist');message('#dashMessage','Checklist item deleted.');}
  catch(error){message('#dashMessage',error.message||'Could not delete checklist item.','error');}
}
async function saveProfile(event) {
  event.preventDefault();const form=new FormData(event.currentTarget);const name=String(form.get('display_name')||'').trim();if(!name)return;
  const theme=String(form.get('profile_theme')||'dreamy');const unlocked=state.attempts.length>=3||state.scenes.filter(s=>s.scenes_completed>=3).length>=2;
  if(theme==='cosmic'&&!unlocked) return message('#dashMessage','Unlock Cosmic Night by completing 3 quizzes or 2 stories.','error');
  if(theme==='pixel'&&state.attempts.length<5) return message('#dashMessage','Unlock Pixel Gamer by completing 5 quizzes.','error');
  const updates={display_name:name,profile_color:String(form.get('profile_color')||'#8879df'),profile_theme:theme,scores_public:form.get('scores_public')==='on'};
  try {const {error}=await supabase.from('profiles').update(updates).eq('id',state.user.id);if(error)throw error;Object.assign(state.profile,updates);$('#userDisplayName').textContent=name;renderView('profile');message('#dashMessage','Your profile has been updated! ✦');}
  catch(error){message('#dashMessage',error.message||'Could not update profile. Run the profile customization SQL upgrade first.','error');}
}

async function signOut() {
  try {await supabase.auth.signOut();} catch(error) { message('#dashMessage',error.message||'Could not log out.','error'); }
  state.user=null;state.profile=null;$('#dashboardShell').hidden=true;$('#authShell').hidden=false;message('#authMessage','You have been logged out.');
}
function setupEvents() {
  $$('[data-auth-mode]').forEach(btn=>btn.addEventListener('click',()=>setAuthMode(btn.dataset.authMode)));
  $('#authForm').addEventListener('submit',submitAuth);
  $('#signOut').addEventListener('click',signOut);
  $('#sideNav').addEventListener('click',event=>{const btn=event.target.closest('[data-view]');if(btn)renderView(btn.dataset.view);});
  $('#password').addEventListener('keydown',event=>{if(event.key==='Enter')$('#authForm').requestSubmit();});
  $('#inviteCode')?.addEventListener('input',event=>{event.target.value=event.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,10);});
}
async function init() {
  if(!supabaseConfigured||!supabase) {
    message('#authMessage','Supabase is not configured. Check supabase-client.js and use only the Project URL and sb_publishable_ key.','error');
    $('#authSubmit').disabled=true;return;
  }
  if(!isTeacher&&state.pendingCode&&$('#inviteCode'))$('#inviteCode').value=state.pendingCode;
  setupEvents();setAuthMode('login');
  const {data:{session},error}=await supabase.auth.getSession();if(error)throw error;
  if(session?.user) await afterSignIn(session.user);
  supabase.auth.onAuthStateChange((event,sessionNow)=>{
    if(event==='SIGNED_OUT') {
      state.user=null;state.profile=null;
      $('#dashboardShell').hidden=true;$('#authShell').hidden=false;
    }
  });
}
init().catch(error=>{
  console.error('STORYVERSE portal initialization error:',error);
  message('#authMessage',error.message||'The portal could not start. Refresh and try again.','error');
});
