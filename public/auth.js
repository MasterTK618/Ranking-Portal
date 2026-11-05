const $ = id => document.getElementById(id);
let challengeActive = false;
function showMessage(message,type="error"){
  const el=$("authMessage");el.textContent=message;el.className="notice "+type;el.classList.remove("hidden");
}
async function post(url,body){
  const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||"Something went wrong.");
  return data;
}
$("createCode").addEventListener("click",async()=>{
  const username=$("robloxUsername").value.trim();
  if(!username)return showMessage("Enter your Roblox username.");
  $("createCode").disabled=true;$("createCode").textContent="Getting code…";
  try{
    const data=await post("/auth/challenge",{username});
    $("verificationCode").textContent=data.code;
    $("stepOne").classList.add("hidden");$("stepTwo").classList.remove("hidden");
    $("authMessage").classList.add("hidden");challengeActive=true;
  }catch(e){showMessage(e.message)}
  finally{$("createCode").disabled=false;$("createCode").textContent="Get emoji sequence";}
});
$("copyCode").addEventListener("click",async()=>{try{await navigator.clipboard.writeText($("verificationCode").textContent);$("copyCode").textContent="Copied!";setTimeout(()=>$("copyCode").textContent="Copy emojis",1600);}catch{showMessage("Select the emojis and copy them manually.");}});
$("verifyCode").addEventListener("click",async()=>{
  if(!challengeActive)return;
  $("verifyCode").disabled=true;$("verifyCode").textContent="Checking profile…";
  try{
    await post("/auth/verify",{});
    location.href="/";
  }catch(e){showMessage(e.message)}
  finally{$("verifyCode").disabled=false;$("verifyCode").textContent="I've added the emojis — verify me";}
});
$("startOver").addEventListener("click",()=>{
  challengeActive=false;$("stepTwo").classList.add("hidden");$("stepOne").classList.remove("hidden");$("authMessage").classList.add("hidden");
});
$("robloxUsername").addEventListener("keydown",e=>{if(e.key==="Enter")$("createCode").click()});
