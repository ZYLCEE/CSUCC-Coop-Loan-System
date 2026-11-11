export class RequestTimeoutError extends Error {
 constructor(message:string){super(message);this.name="RequestTimeoutError";}
}

// Also bounds SDK calls (such as getSession) that do not accept an AbortSignal.
// The callback must check/use the signal before starting any later request.
export async function withRequestDeadline<T>(operation:(signal:AbortSignal)=>Promise<T>,milliseconds:number,message:string,parent?:AbortSignal|null):Promise<T>{
 const controller=new AbortController();
 let timer:ReturnType<typeof setTimeout>|undefined;
 let onAbort:()=>void=()=>{};
 const stopped=new Promise<never>((_,reject)=>{
  onAbort=()=>{controller.abort(parent?.reason);reject(parent?.reason??new DOMException("Request cancelled.","AbortError"));};
  if(parent?.aborted){onAbort();return;}
  parent?.addEventListener("abort",onAbort,{once:true});
  timer=setTimeout(()=>{const error=new RequestTimeoutError(message);controller.abort(error);reject(error);},milliseconds);
 });
 try{
  return await Promise.race([Promise.resolve().then(()=>{controller.signal.throwIfAborted();return operation(controller.signal);}),stopped]);
 }finally{
  clearTimeout(timer);parent?.removeEventListener("abort",onAbort);
 }
}

// Keep the signal alive through response-body reads, including a stalled SDK JSON response.
export function fetchWithDeadline(parent?:AbortSignal, milliseconds=15000):typeof fetch{
 return (input,init)=>{
  const inputSignal=typeof Request!=="undefined"&&input instanceof Request?input.signal:undefined;
  const signals=[AbortSignal.timeout(milliseconds),parent,init?.signal,inputSignal].filter((signal):signal is AbortSignal=>!!signal);
  return fetch(input,{...init,signal:AbortSignal.any(signals)});
 };
}
