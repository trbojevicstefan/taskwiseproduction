const fs = require('fs');
const assert = require('node:assert/strict');
const dir = __dirname + '/';
const writer = JSON.parse(fs.readFileSync(dir+'taskwise-blog-writer.json','utf8'));
const feed = JSON.parse(fs.readFileSync(dir+'taskwise-blog-feed.json','utf8'));
const selector = writer.nodes.find(n=>n.name==='Select Taskwise Topic').parameters.jsCode;
const row = {Status:'Ready',Slug:'meeting-notes-to-tasks','Blog Title':'Meeting notes to tasks',Type:'Guide','Cover Image URL':'https://example.com/cover.png','Inline Image URL':'https://example.com/inline.png'};
const run = (rows,published=[])=>new Function('$',selector)(name=>({first:()=>({json:{topics:rows}}),all:()=>published.map(slug=>({json:{slug}}))}));
assert.equal(run([row])[0].json.slug,row.Slug);
assert.equal(run([row],[row.Slug]).length,0);
assert.equal(run([{...row,'Publish After':'2099-01-01'}]).length,0);
assert.throws(()=>run([{...row,'Inline Image URL':row['Cover Image URL']}]),/Two distinct/);
assert.equal(run([{...row,Status:'Draft'}]).length,0);
for(const n of writer.nodes.filter(n=>n.type==='n8n-nodes-base.googleFirebaseCloudFirestore')) {
  assert.equal(n.parameters.projectId,'=taskwiseai-v0');
  assert.equal(n.parameters.collection,'taskwise_blog_posts');
}
assert.equal(writer.nodes.find(n=>n.type==='n8n-nodes-base.scheduleTrigger').parameters.rule.interval[0].expression,'0 12 * * 1,3,5');
const feedCode=feed.nodes.find(n=>n.type==='n8n-nodes-base.code').parameters.jsCode;
const getFeed=(records,slug='')=>new Function('$input','$',feedCode)({all:()=>records.map(json=>({json}))},()=>({first:()=>({json:{query:{slug}}})}))[0].json;
assert.deepEqual(getFeed([{slug:'draft',status:'draft'},{slug:'published',status:'published',site:'https://opaya.dev'}]).posts,[]);
assert.equal(getFeed([{...row,slug:'published',status:'published',site:'https://www.taskwise.ai'}]).posts.length,1);
assert.equal(getFeed([], '../unsafe').post,null);
assert.equal(getFeed(Array.from({length:65},(_,i)=>({slug:'article-'+i,status:'published',site:'https://www.taskwise.ai'}))).posts.length,65);
console.log('Taskwise automation checks passed');

