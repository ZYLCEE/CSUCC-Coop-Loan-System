import {CommitteeError} from "./committeeServer";

export async function updateCommitteeAuthUser(context:{url:string;key:string;token:string;user:{id:string}},attributes:{password:string}|{data:{full_name:string;phone:string}}){
 // Auth.updateUser() needs an SDK-stored session. The server already verified
 // this bearer, so send it to Auth without collecting a browser refresh token.
 const response=await fetch(context.url+"/auth/v1/user",{method:"PUT",headers:{Authorization:"Bearer "+context.token,apikey:context.key,"Content-Type":"application/json"},body:JSON.stringify(attributes),cache:"no-store"});
 const result=await response.json().catch(()=>null);
 if(response.ok){if((result?.id??result?.user?.id)!==context.user.id)throw new CommitteeError("The account service returned an incomplete update. Your setup is not complete; please retry.",503);return;}
 const code=result?.code??result?.error_code;
 if(code==="same_password")throw new CommitteeError("Choose a new password different from your temporary or current password.");
 if(code==="weak_password")throw new CommitteeError("The new password does not meet the account security requirements. Use a stronger password with uppercase, lowercase, a number and a symbol.");
 if(response.status===429)throw new CommitteeError("Too many attempts. Wait a moment and retry.",429);
 if(response.status===401||["session_not_found","refresh_token_not_found","bad_jwt"].includes(code))throw new CommitteeError("Your session expired. Sign in again with your current password.",401);
 if(["reauthentication_needed","reauthentication_not_valid"].includes(code))throw new CommitteeError("Sign in again with your current password, then retry the password change.",401);
 if(code==="insufficient_aal")throw new CommitteeError("Complete your account's additional authentication before changing its password.",403);
 throw new CommitteeError(response.status>=500?"The account service is temporarily unavailable. Your setup is not complete; please retry.":"The account service could not save these changes. Check the details and retry.",response.status>=500?503:400);
}
