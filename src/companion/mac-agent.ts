// JXA agent: stdout is reserved for JSON Lines; callbacks must catch errors
// because JXA silently swallows Objective-C callback exceptions. Keep script ASCII.
export function buildMacAgentCommand(): { cmd: string; args: string[] } {
  const jxa = String.raw`
ObjC.import('Cocoa')
ObjC.import('WebKit')
var NL=String.fromCharCode(10)
var out=$.NSFileHandle.fileHandleWithStandardOutput
function emit(m) { try { out.writeData($.NSString.alloc.initWithUTF8String(JSON.stringify(m)+NL).dataUsingEncoding($.NSUTF8StringEncoding)) } catch(e) {} }
function guard(name,fn) { return function() { try { return fn.apply(null,arguments) } catch(e) { emit({ev:'error',message:name+': '+e}) } } }
var app=$.NSApplication.sharedApplication
app.setActivationPolicy(1)
var W=300,H=Math.round(300*250/180)
var win=$.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer($.NSMakeRect(0,0,W,H),0,2,false)
win.setOpaque(false)
win.setBackgroundColor($.NSColor.clearColor)
win.setHasShadow(false)
win.setLevel(3)
win.setCollectionBehavior((1<<0)|(1<<4)|(1<<6))
var config=$.WKWebViewConfiguration.alloc.init
var controller=$.WKUserContentController.alloc.init
var Bridge=ObjC.registerSubclass({name:'DshPetBridge',protocols:['WKScriptMessageHandler'],methods:{'userContentController:didReceiveScriptMessage:':{types:['void',['id','id']],implementation:guard('bridge',function(c,m){
  var msg=JSON.parse(ObjC.unwrap(m.body))
  bridge(msg)
})}}})
var bridgeHandler=Bridge.alloc.init
controller.addScriptMessageHandlerName(bridgeHandler,$('pet'))
config.setUserContentController(controller)
var web=$.WKWebView.alloc.initWithFrameConfiguration($.NSMakeRect(0,0,W,H),config)
web.setValueForKey($.NSNumber.numberWithBool(false),'drawsBackground')
win.setContentView(web)
var visible=false,drag=false,lastMouse=null,lastBoundsEvent=0
function bounds(m) {
  var w=Math.max(180,Math.min(480,Number(m.width)||300)),h=Math.round(w*250/180)
  var f=win.frame
  var x=Number.isFinite(Number(m.x)) ? Number(m.x) : f.origin.x
  var y=Number.isFinite(Number(m.y)) ? Number(m.y) : f.origin.y
  win.setFrameDisplay($.NSMakeRect(x,y,w,h),true)
  moved()
}
function moved() { var f=win.frame; lastBoundsEvent=Date.now();emit({ev:'moved',x:Math.round(f.origin.x),y:Math.round(f.origin.y),width:Math.round(f.size.width),height:Math.round(f.size.height)}) }
function endDrag() { if (!drag) return; drag=false; moved() }
$.NSTimer.scheduledTimerWithTimeIntervalRepeatsBlock(1/60,true,guard('drag',function(){
  if(!drag) return
  if(($.NSEvent.pressedMouseButtons & 1)===0 || !visible) {endDrag();return}
  var p=$.NSEvent.mouseLocation
  var f=win.frame
  win.setFrameOrigin($.NSMakePoint(f.origin.x+p.x-lastMouse.x,f.origin.y+p.y-lastMouse.y))
  lastMouse=p
  if(Date.now()-lastBoundsEvent>250) moved()
}))
function bridge(m) {
  if(m.type==='drag-start') {drag=true;lastMouse=$.NSEvent.mouseLocation}
  else if(m.type==='drag-end') {endDrag()}
  else if(m.type==='resize') {var f=win.frame;bounds({width:f.size.width+Number(m.delta),x:f.origin.x,y:f.origin.y})}
  else if(m.type==='close'||m.type==='return-stage') {endDrag();win.orderOut($());visible=false;emit({ev:m.type==='close'?'closed':'return-stage'})}
}
function handle(line) {
  var m=JSON.parse(line)
  if(m.cmd==='quit') {app.terminate($());return}
  if(m.cmd==='hide') {endDrag();win.orderOut($());visible=false;return}
  if(m.cmd==='set-bounds') {bounds(m.bounds);return}
  if(m.cmd==='show'||m.cmd==='set-model') {
    bounds(m.bounds||{})
    var url=$.NSURL.URLWithString($(String(m.url)))
    web.loadFileURLAllowingReadAccessToURL(url,url.URLByDeletingLastPathComponent.URLByDeletingLastPathComponent.URLByDeletingLastPathComponent)
    win.orderFrontRegardless
    visible=true
    emit({ev:'shown'})
    return
  }
  emit({ev:'error',message:'unknown command '+m.cmd})
}
var stdin=$.NSFileHandle.fileHandleWithStandardInput,buf=''
$.NSNotificationCenter.defaultCenter.addObserverForNameObjectQueueUsingBlock($.NSFileHandleDataAvailableNotification,stdin,$.NSOperationQueue.mainQueue,function(){
  try {
    var data=stdin.availableData
    if(data.length===0) {app.terminate($());return}
    buf+=$.NSString.alloc.initWithDataEncoding(data,$.NSUTF8StringEncoding).js
    var i
    while((i=buf.indexOf(NL))>=0) {var line=buf.slice(0,i);buf=buf.slice(i+1);try {handle(line)} catch(e) {emit({ev:'error',message:'command: '+e})}}
  } catch(e) {emit({ev:'error',message:'stdin: '+e})}
  stdin.waitForDataInBackgroundAndNotify
})
stdin.waitForDataInBackgroundAndNotify
emit({ev:'ready'})
app.run
`.trim()
  return { cmd: 'osascript', args: ['-l', 'JavaScript', '-e', jxa] }
}
