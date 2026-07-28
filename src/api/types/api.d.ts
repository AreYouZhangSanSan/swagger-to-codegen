// Auto-generated type definitions

export interface PolicyCreateRequest {
  title: string;
  url?: string;
  content?: string;
  publish_time?: string;
  publish_department?: string;
  source?: string;
  category?: string;
  file_info?: string;
}

export interface PolicyDeleteRequest {
  id: number;
}

export interface PolicyUpdateRequest {
  id: number;
  title?: any;
  url?: any;
  content?: any;
  publish_time?: any;
  publish_department?: any;
  source?: any;
  category?: any;
  file_info?: any;
}
