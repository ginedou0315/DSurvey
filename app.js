'use strict';
const app = document.querySelector('#app');
const route = new URLSearchParams(location.hash.slice(1));
const id = route.get('form');
const key = route.get('key');
const endpoint = id && '/api/forms/' + encodeURIComponent(id);
const fieldTypes = {text:'Short text',textarea:'Long text',email:'Email',date:'Date',number:'Number',select:'Dropdown'};
const templates = {
  blank: {title:'',description:'',fields:[['Name','text']]},
  attendance: {title:'Event attendance',description:'Please confirm whether you will attend.',fields:[['Name','text'],['Email','email'],['Attendance','select',['Attending','Unable to attend']],['Notes','textarea']]},
  concerns: {title:'Share a concern',description:'Tell us what happened and how we can help.',fields:[['Concern','textarea'],['Email for follow-up','email'],['Additional notes','textarea']]},
  registration: {title:'Event registration',description:'Complete this form to register.',fields:[['Name','text'],['Email','email'],['Address','text'],['Notes','textarea']]}
};
const questionKits = [
  {name:'Contact details',fields:[['Name','text',[],true],['Email','email',[],true]]},
  {name:'Attendance',fields:[['Will you attend?','select',['Yes','No','Not sure'],true]]},
  {name:'Address',fields:[['Address','text',[],false]]},
  {name:'Notes',fields:[['Notes','textarea',[],false]]}
];
const starterCards = [
  ['attendance','Event attendance','Ask who’s coming and get a response tally.'],
  ['concerns','Concerns','Collect concerns with an optional email for follow-up.'],
  ['registration','Registration','Collect names, contact details, and notes.']
];
let form;
let draft;
let ownerView = 'edit';
let responsePage = 0;
let responseRows;
let viewRevision = 0;
const pageSize = 25;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name,value] of Object.entries(attrs)) {
    if (name.startsWith('on')) node.addEventListener(name.slice(2),value);
    else if (typeof value === 'boolean') node.toggleAttribute(name,value);
    else if (value != null) node.setAttribute(name,value);
  }
  node.append(...children.flat().filter(value => value != null));
  return node;
}
const label = (name, control) => el('label',{},name,control);
const button = (name, action, attrs = {}) => el('button',{type:'button',onclick:action,...attrs},name);
const panel = (...children) => el('section',{class:'panel'},...children);
const status = () => el('p',{class:'status',role:'status','aria-live':'polite'});
const url = (formId, secret) => location.origin + '/#' + new URLSearchParams(secret ? {form:formId,key:secret} : {form:formId});
const field = (name = '', type = 'text', options = [], required = false) => ({id:crypto.randomUUID(),label:name,type,options,required});
const date = value => new Date(value).toLocaleString();
const storageKey = 'dsurvey.owner-links';
function savedForms() {
  try { return JSON.parse(localStorage.getItem(storageKey)) || {}; } catch { return {}; }
}
function remember(formId, secret, definition) {
  try {
    const saved = savedForms();
    saved[formId] = {secret,title:definition.title,open:definition.open};
    localStorage.setItem(storageKey,JSON.stringify(saved));
  } catch {}
}
function forget(formId) {
  try {
    const saved = savedForms();
    delete saved[formId];
    localStorage.setItem(storageKey,JSON.stringify(saved));
  } catch {}
  dashboard();
}
function notify(note, message, error = false) {
  note.textContent = message;
  note.classList.toggle('error',error);
}
async function api(path, method = 'GET', payload, owner = false) {
  const headers = {};
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  if (owner) headers.Authorization = 'Bearer ' + key;
  const response = await fetch(path,{method,headers,body:payload === undefined ? undefined : JSON.stringify(payload)});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}
function view(...nodes) {
  app.replaceChildren(...nodes);
  app.setAttribute('aria-busy','false');
}
function dashboard() {
  app.className = '';
  const cards = Object.entries(savedForms()).reverse().map(([formId,item]) => el('article',{class:'card'},
    el('div',{class:'top'},el('h3',{},item.title),el('span',{class:'badge'},item.open ? 'Published' : 'Closed')),
    el('div',{class:'row'},el('a',{class:'button',href:url(formId,item.secret)},'Manage form'),
      button('Remove shortcut',() => forget(formId)))));
  const manageInput = el('input',{type:'url',required:true,placeholder:'Paste a management link'});
  const message = status();
  const open = el('form',{class:'stack',onsubmit:event => {
    event.preventDefault();
    try {
      const supplied = new URL(manageInput.value);
      const params = new URLSearchParams(supplied.hash.slice(1));
      if (supplied.origin !== location.origin || !/^[\da-f-]{36}$/.test(params.get('form') || '') || !/^[\da-f]{64}$/.test(params.get('key') || '')) throw Error();
      location.href = url(params.get('form'),params.get('key'));
    } catch { notify(message,'Enter a management link from this DSurvey site.',true); }
  }},label('Management link',manageInput),el('div',{},el('button',{},'Open dashboard')),message);
  view(el('section',{class:'panel intro home-intro'},el('h1',{},'What do you need to collect?'),
    el('p',{class:'muted'},'Pick a starting point and make the questions your own.'),
    el('div',{class:'row'},button('Start from scratch',() => startDraft('blank'),{class:'primary'}))),
    el('section',{class:'starters','aria-label':'Form templates'},starterCards.map(([template,name,hint]) =>
      el('button',{type:'button',class:'starter',onclick:() => startDraft(template)},
        el('strong',{},name),el('span',{},hint)))),
    panel(el('h2',{},'My forms'),cards.length ? el('div',{class:'cards'},cards) :
      el('p',{class:'muted'},'Forms you manage on this device will appear here.')),
    panel(el('h2',{},'Open an existing form'),open));
}
function startDraft(template) {
  const data = templates[template];
  draft = {title:data.title,description:data.description,open:true,
    fields:data.fields.map(([name,type,options],i) => field(name,type,options,i === 0))};
  app.className = '';
  view(el('h1',{},'Create a form'),editor(draft));
  app.querySelector('input')?.focus();
}
function editor(current) {
  const questions = el('div',{class:'stack'});
  const message = status();
  const preview = el('div',{class:'preview-content'});
  const previewSection = el('section',{class:'builder-preview',id:'builder-preview','aria-label':'Respondent preview'});
  const togglePreview = button('Preview form',() => {
    const visible = previewSection.classList.toggle('preview-visible');
    togglePreview.textContent = visible ? 'Back to editing' : 'Preview form';
    togglePreview.setAttribute('aria-expanded',String(visible));
  },{class:'preview-toggle','aria-controls':'builder-preview','aria-expanded':'false'});
  function updatePreview() {
    const previewNote = status();
    const controls = answerControls(current.fields);
    preview.replaceChildren(formIntro(current,'Your form title'),
      current.open ? panel(el('form',{class:'stack',onsubmit:event => {
        event.preventDefault();
        notify(previewNote,'That’s the end of the preview.');
      }},answerLabels(controls),el('div',{},el('button',{class:'primary'},'Try submitting')),previewNote)) :
        panel(el('p',{},'This form is no longer accepting responses.')));
  }
  const title = el('input',{required:true,maxlength:120,value:current.title,oninput:event => {
    current.title = event.target.value;
    updatePreview();
  }});
  const description = el('textarea',{maxlength:2000,oninput:event => {
    current.description = event.target.value;
    updatePreview();
  }},current.description);
  const redraw = (focus = null, selector = 'input') => {
    questions.replaceChildren(...current.fields.map((question,index) => {
      const shift = delta => {
        const destination = index + delta;
        [current.fields[index],current.fields[destination]] = [current.fields[destination],current.fields[index]];
        redraw(question.id,`button[data-move="${delta}"]:not([disabled])`);
      };
      const options = el('textarea',{oninput:event => {
        question.options = event.target.value.split(/\r?\n/);
        updatePreview();
      }},question.options.join('\n'));
      const optionLabel = label('Choices, one per line',options);
      optionLabel.hidden = question.type !== 'select';
      const type = el('select',{onchange:event => {
        question.type = event.target.value;
        options.required = question.type === 'select';
        optionLabel.hidden = !options.required;
        updatePreview();
      }},Object.entries(fieldTypes).map(([value,name]) => el('option',{value,selected:value === question.type},name)));
      options.required = question.type === 'select';
      return el('div',{class:'question','data-field':question.id},
        el('div',{class:'top'},el('strong',{},'Question ' + (index + 1)),el('div',{class:'row'},
          button('Up',() => shift(-1),{disabled:index === 0,'aria-label':'Move question up','data-move':'-1'}),
          button('Down',() => shift(1),{disabled:index === current.fields.length - 1,'aria-label':'Move question down','data-move':'1'}),
          button('Remove',() => {current.fields.splice(index,1); redraw(current.fields[Math.min(index,current.fields.length - 1)]?.id);},
            {class:'danger',disabled:current.fields.length === 1,'aria-label':'Remove question ' + (index + 1)}))),
        el('div',{class:'stack'},el('div',{class:'cols'},
          label('Question',el('input',{type:'text',value:question.label,required:true,maxlength:120,oninput:event => {
            question.label = event.target.value;
            updateKits();
            updatePreview();
          }})),
          label('Answer type',type)),optionLabel,
          el('label',{class:'check'},el('input',{type:'checkbox',checked:question.required,onchange:event => {
            question.required = event.target.checked;
            updatePreview();
          }}),'Required')));
    }));
    add.disabled = current.fields.length >= 30;
    updateKits();
    updatePreview();
    if (focus) {
      const question = questions.querySelector(`[data-field="${CSS.escape(focus)}"]`);
      (question?.querySelector(selector) || question?.querySelector('input'))?.focus();
    }
  };
  const add = button('Add question',() => {
    const next = field();
    current.fields.push(next);
    redraw(next.id);
  });
  function missingQuestions(kit) {
    const names = new Set(current.fields.map(question => question.label.trim().toLowerCase()));
    return kit.fields.filter(([name]) => !names.has(name.toLowerCase()));
  }
  const kitButtons = questionKits.map(kit => button(kit.name,() => {
    const added = missingQuestions(kit).map(args => field(...args));
    current.fields.push(...added);
    redraw(added[0]?.id);
  }));
  function updateKits() {
    for (const [index,kit] of questionKits.entries()) {
      const count = missingQuestions(kit).length;
      kitButtons[index].disabled = !count || current.fields.length + count > 30;
    }
  }
  const creatorControl = !key && document.documentElement.dataset.creationProtected === 'true' ?
    el('input',{type:'password',required:true,autocomplete:'off'}) : null;
  redraw();
  const save = el('button',{class:'primary'},key ? 'Save changes' : 'Publish form');
  const editing = panel(el('form',{class:'stack',onsubmit:async event => {
    event.preventDefault();
    const controls = Array.from(event.currentTarget.elements).filter(control => !control.disabled);
    controls.forEach(control => {control.disabled = true;});
    notify(message,'Saving…');
    try {
      if (key) {
        form = await api(endpoint + '/manage','PUT',current,true);
        remember(id,key,form);
        draft = structuredClone(form);
        owner('Changes saved.');
      } else {
        const result = await api('/api/forms','POST',{...current,creatorKey:creatorControl?.value});
        remember(result.id,result.key,result.form);
        location.href = url(result.id,result.key);
      }
    } catch (error) { notify(message,error.message,true); }
    finally { controls.forEach(control => {control.disabled = false;}); }
  }},label('Form title',title),label('Introduction or privacy notice',description),
  el('section',{class:'quick-add','aria-label':'Quick add questions'},el('h2',{},'Quick add'),
    el('div',{class:'row'},kitButtons)),
  el('h2',{},'Questions'),questions,el('div',{},add),
  key ? el('label',{class:'check'},el('input',{type:'checkbox',checked:current.open,onchange:event => {
    current.open = event.target.checked;
    updatePreview();
  }}),'Accept responses') : null,
  creatorControl ? label('Form creation key',creatorControl) : null,
  el('div',{class:'row'},save,key ? null : button('Cancel',dashboard)),message));
  previewSection.append(el('h2',{},'Live preview'),el('p',{class:'muted'},'Try the form here. Preview answers are never saved.'),preview);
  return el('div',{},togglePreview,el('div',{class:'builder-layout'},el('div',{class:'builder-edit'},editing),previewSection));
}
function linkBox(name, value, note) {
  const input = el('input',{readonly:true,value,onclick:event => event.target.select()});
  return el('div',{class:'linkbox'},label(name,input),el('div',{class:'row'},
    button('Copy link',async () => {
      try { await navigator.clipboard.writeText(value); notify(note,name + ' copied.'); }
      catch {input.select(); notify(note,'Link selected. Use your device’s Copy command.');}
    }),
    name === 'Respondent link' ? el('a',{class:'button',href:value,target:'_blank',rel:'noopener'},'Open respondent view') : null));
}
function owner(message = '') {
  app.className = '';
  const pageRevision = ++viewRevision;
  const notice = status();
  notify(notice,message);
  const tabs = el('div',{class:'row tabs','aria-label':'Dashboard view'},
    ...[['edit','Build'],['share','Share'],['responses','Responses']].map(([value,name]) =>
      button(name,() => {ownerView = value; owner();},{'aria-pressed':String(value === ownerView)})));
  const content = el('div');
  view(el('div',{class:'top'},el('h1',{},form.title),el('span',{class:'badge'},form.open ? 'Published' : 'Closed')),
    el('p',{class:'muted lead'},'Form dashboard'),notice,tabs,content);
  if (ownerView === 'edit') content.append(editor(draft));
  if (ownerView === 'share') content.append(panel(el('h2',{},'Share your form'),
    el('p',{class:'muted'},form.open ? 'Send the respondent link to the people you want to hear from.' : 'This form is closed. Enable “Accept responses” in Build to reopen it.'),
    linkBox('Respondent link',url(id),notice),
    el('p',{class:'muted'},'Save the private management link somewhere secure. Anyone with it can edit the form and view its responses.'),
    linkBox('Management link',url(id,key),notice)));
  if (ownerView === 'responses') loadResponses(content,pageRevision);
}
async function loadResponses(content, revision) {
  content.replaceChildren(panel(el('p',{role:'status'},'Loading responses…')));
  try {
    const rows = [];
    let after = 0;
    while (revision === viewRevision) {
      const batch = await api(endpoint + '/responses?after=' + after,'GET',undefined,true);
      rows.push(...batch);
      if (batch.length < 200) break;
      after = batch.at(-1).id;
    }
    if (revision !== viewRevision) return;
    responseRows = rows.reverse();
    responsePage = 0;
    renderResponses(content);
  } catch (error) {
    if (revision === viewRevision) content.replaceChildren(panel(el('p',{role:'alert'},error.message),
      button('Retry',() => loadResponses(content,revision))));
  }
}
function summaryData(rows, fields) {
  return fields.map(question => {
    let answered = 0;
    const choices = new Map(question.options.map(option => [option,0]));
    for (const row of rows) {
      const value = row.answers[question.id];
      if (!value) continue;
      answered++;
      if (question.type === 'select') choices.set(value,(choices.get(value) || 0) + 1);
    }
    return {question,answered,choices};
  });
}
function renderResponses(content) {
  const fields = [...form.fields,...form.archived];
  const headers = ['Submitted (UTC)',...fields.map(question =>
    question.label + (form.archived.includes(question) ? ' (removed)' : ''))];
  const rows = responseRows;
  const summaries = summaryData(rows,form.fields);
  const exportNote = status();
  const summaryRows = [['Question','Measure','Count'],['','Total responses',rows.length]];
  for (const {question,answered,choices} of summaries) {
    summaryRows.push([question.label,'Answered',answered],[question.label,'Unanswered',rows.length - answered]);
    for (const [choice,count] of choices) summaryRows.push([question.label,choice,count]);
  }
  const exportRows = () => [headers,...rows.map(row => [row.submitted,...fields.map(question => row.answers[question.id] ?? '')])];
  const execute = (name, callback) => button(name,async event => {
    const control = event.currentTarget;
    control.disabled = true;
    notify(exportNote,'Preparing download…');
    try { await new Promise(resolve => setTimeout(resolve,0)); await callback(); notify(exportNote,'Download prepared.'); }
    catch (error) { notify(exportNote,error.message || 'The report could not be downloaded.',true); }
    finally { control.disabled = false; }
  },{disabled:!rows.length});
  const display = rows.slice(responsePage * pageSize,(responsePage + 1) * pageSize);
  const totalPages = Math.ceil(rows.length / pageSize);
  const table = el('table',{},el('thead',{},el('tr',{},['Submitted (local time)',...headers.slice(1),'Action'].map(name => el('th',{scope:'col'},name)))),
    el('tbody',{},display.map(row => el('tr',{},el('td',{},date(row.submitted)),
      ...fields.map(question => el('td',{},row.answers[question.id] || '—')),
      el('td',{},button('Delete',async event => {
        if (!window.confirm('Permanently delete this response?')) return;
        const control = event.currentTarget;
        control.disabled = true;
        try {
          await api(endpoint + '/responses?response=' + row.id,'DELETE',undefined,true);
          if (content.isConnected) await loadResponses(content,viewRevision);
        } catch (error) { notify(exportNote,error.message,true); }
        finally { control.disabled = false; }
      },{class:'danger'}))))));
  content.replaceChildren(panel(el('div',{class:'top'},el('h2',{},'Response summary'),button('Refresh',() => loadResponses(content,viewRevision))),
    el('div',{class:'row'},el('span',{class:'metric'},String(rows.length)),el('span',{class:'muted'},rows.length === 1 ? 'response' : 'responses')),
    rows.length ? el('div',{class:'cards'},summaries.map(({question,answered,choices}) => el('section',{class:'card'},
      el('h3',{},question.label),el('p',{class:'muted'},answered + ' of ' + rows.length + ' answered'),
      [...choices].map(([choice,count]) => el('div',{class:'summary-line'},
        el('div',{},choice + ' · ' + count),el('meter',{class:'meter',min:0,max:rows.length,value:count,'aria-label':choice + ' responses'}))))))
      : el('p',{class:'muted'},'Share your respondent link to start collecting answers.')),
    panel(el('div',{class:'top'},el('h2',{},'Response table'),el('div',{class:'row'},
      execute('Download Excel',() => DSurveyReports.excel(form.title,exportRows(),summaryRows)),
      execute('Download PDF',() => DSurveyReports.pdf(form.title,exportRows(),summaryRows)))),
    exportNote,
    rows.length ? el('div',{class:'table-wrap',tabindex:0,'aria-label':'Response table'},table) : null,
    totalPages > 1 ? el('div',{class:'row tabs'},
      button('Previous',() => {responsePage--; renderResponses(content);},{disabled:responsePage === 0}),
      el('span',{},'Page ' + (responsePage + 1) + ' of ' + totalPages),
      button('Next',() => {responsePage++; renderResponses(content);},{disabled:responsePage + 1 === totalPages})) : null));
}
function formIntro(definition,fallback = '') {
  return el('section',{class:'panel intro'},el('h1',{},definition.title.trim() || fallback),
    definition.description ? el('p',{class:'muted'},definition.description) : null);
}
function answerControls(fields) {
  return fields.map(question => {
    let control;
    if (question.type === 'textarea') control = el('textarea',{maxlength:4000});
    else if (question.type === 'select') control = el('select',{},el('option',{value:''},'Select an answer'),
      ...[...new Set(question.options.map(option => option.trim()).filter(Boolean))].slice(0,30)
        .map(option => el('option',{value:option},option)));
    else control = el('input',{type:question.type,maxlength:4000,step:question.type === 'number' ? 'any' : null});
    control.required = question.required;
    return [question,control];
  });
}
function answerLabels(controls) {
  return controls.map(([question,control]) => label((question.label.trim() || 'Untitled question') + (question.required ? ' *' : ''),control));
}
function respondent() {
  app.className = 'narrow';
  const notice = status();
  const controls = answerControls(form.fields);
  const submit = el('button',{class:'primary'},'Submit response');
  view(formIntro(form),
    form.open ? panel(el('form',{class:'stack',onsubmit:async event => {
      event.preventDefault();
      submit.disabled = true;
      notify(notice,'Submitting…');
      try {
        await api(endpoint + '/responses','POST',{revision:form.revision,
          answers:Object.fromEntries(controls.map(([question,control]) => [question.id,control.value]))});
        const confirmation = el('h2',{tabindex:-1},'Response received');
        view(panel(confirmation,el('p',{},'Thank you for completing ' + form.title + '.')));
        confirmation.focus();
      } catch (error) { notify(notice,error.message,true); }
      finally { submit.disabled = false; }
    }},answerLabels(controls),
    el('div',{},submit),notice)) : panel(el('p',{},'This form is no longer accepting responses.')));
}
async function init() {
  if (!id) return dashboard();
  try {
    form = await api(key ? endpoint + '/manage' : endpoint,'GET',undefined,Boolean(key));
    if (key) {
      remember(id,key,form);
      draft = structuredClone(form);
      ownerView = 'share';
      owner();
    } else respondent();
  } catch (error) {
    view(panel(el('h1',{},'Unable to open form'),el('p',{role:'alert'},error.message)));
  }
}
window.addEventListener('hashchange',() => location.reload());
init();
