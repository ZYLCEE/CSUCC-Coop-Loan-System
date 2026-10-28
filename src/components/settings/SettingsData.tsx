export interface GeneralSettings {
  cooperativeName: string;
  maxUploadSize: string;
  allowedFileTypes: string;
  otpExpiration: string;
  passwordMinLength: string;
  maintenanceMode: boolean;
}

export interface EmailSettings {
  smtpHost: string;
  smtpPort: string;
  senderEmail: string;
  senderName: string;
}

export const generalSettings: GeneralSettings = {
  cooperativeName: "CSUCC Multi-Purpose Cooperative",
  maxUploadSize: "10",
  allowedFileTypes: "PDF, DOCX, PNG, JPG",
  otpExpiration: "5",
  passwordMinLength: "8",
  maintenanceMode: false,
};

export const emailSettings: EmailSettings = {
  smtpHost: "smtp.example.com",
  smtpPort: "587",
  senderEmail: "noreply@csucc.coop",
  senderName: "CSUCC Cooperative",
};
