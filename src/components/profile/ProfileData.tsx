export interface Profile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  department: string;
  position: string;
  role: string;
  username: string;
  accountStatus: string;
  dateCreated: string;
  lastPasswordChange: string;
  lastLogin: string;
  office: string;
}

export interface Activity {
  id: string;
  action: string;
  description: string;
  date: string;
  time: string;
}

export const profile: Profile = {
  id: "",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  department: "",
  position: "",
  role: "Unknown",
  username: "",
  accountStatus: "Unknown",
  dateCreated: "",
  lastPasswordChange: "",
  lastLogin: "",
  office: "",
};

export const activities: Activity[] = [];
