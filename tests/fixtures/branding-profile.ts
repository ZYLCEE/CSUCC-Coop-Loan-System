import type {ProfileResponse} from "../../src/lib/profileModel";

export async function profileRequest():Promise<ProfileResponse>{
  return {
    profile:{first_name:"Synthetic Alexandra",last_name:"Villanueva",phone:"",department:"Cooperative Office",position:"Administrator"},
    account:{id:"synthetic-staff",email:"staff@example.invalid",pendingEmail:null,role:"Super Administrator",status:"Active",createdAt:"2026-01-01T00:00:00Z",lastSignInAt:"2026-11-11T00:00:00Z",emailConfirmed:true},
    memberLinked:false,
  };
}

export async function committeeRequest(){return {accounts:[],bodEnabled:false};}
