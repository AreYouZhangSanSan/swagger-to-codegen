// Auto-generated type definitions

export interface DistrictCreateRequest {
  name: string;
  code: string;
  type?: string | null;
  city?: string | null;
  city_code?: string | null;
  city_type?: string | null;
  province?: string | null;
  province_code?: string | null;
  province_type?: string | null;
  former_name?: string | null;
  note?: string | null;
  eng_name?: string | null;
  var_name?: string | null;
}

export interface DistrictDeleteRequest {
  id?: number | null;
  ids?: number[] | null;
  force?: boolean;
}

export interface DistrictDeleteResult {
  deleted?: number;
  skipped?: DistrictReference[];
  not_found?: number[];
}

export interface DistrictOption {
  id?: number | null;
  code?: string | null;
  name?: string | null;
  type?: string | null;
  district_count?: number;
  children?: DistrictOption[];
}

export interface DistrictReference {
  id?: number | null;
  code: string;
  name?: string | null;
  references?: Record<string, number>;
}

export interface DistrictUpdateRequest {
  name?: string | null;
  code?: string | null;
  type?: string | null;
  city?: string | null;
  city_code?: string | null;
  city_type?: string | null;
  province?: string | null;
  province_code?: string | null;
  province_type?: string | null;
  former_name?: string | null;
  note?: string | null;
  eng_name?: string | null;
  var_name?: string | null;
  id: number;
}

export interface HyoRiver {
  created_at?: string;
  id: number;
  name: string;
  code: string;
  length?: number | null;
  up_name?: string | null;
  department?: string | null;
  water_type?: string | null;
  landform?: string | null;
  layer?: string | null;
  area_name?: string | null;
  basin_name?: string | null;
  s_name?: string | null;
  e_name?: string | null;
  area?: number | null;
  grade?: string | null;
  area_code?: string | null;
  std_code?: string | null;
}

export interface PageResponse_HyoRiver_ {
  current: number;
  size: number;
  total: number;
  total_page: number;
  data?: HyoRiver[];
}

export interface PageResponse_SysDistrict_ {
  current: number;
  size: number;
  total: number;
  total_page: number;
  data?: SysDistrict[];
}

export interface Result_DistrictDeleteResult_ {
  code?: string;
  msg?: string;
  data?: DistrictDeleteResult | null;
}

export interface Result_HyoRiver_ {
  code?: string;
  msg?: string;
  data?: HyoRiver | null;
}

export interface Result_PageResponse_HyoRiver__ {
  code?: string;
  msg?: string;
  data?: PageResponse_HyoRiver_ | null;
}

export interface Result_PageResponse_SysDistrict__ {
  code?: string;
  msg?: string;
  data?: PageResponse_SysDistrict_ | null;
}

export interface Result_RiverDeleteResult_ {
  code?: string;
  msg?: string;
  data?: RiverDeleteResult | null;
}

export interface Result_SysDistrict_ {
  code?: string;
  msg?: string;
  data?: SysDistrict | null;
}

export interface Result_list_DistrictOption__ {
  code?: string;
  msg?: string;
  data?: DistrictOption[] | null;
}

export interface Result_list_RiverOption__ {
  code?: string;
  msg?: string;
  data?: RiverOption[] | null;
}

export interface RiverCreateRequest {
  name: string;
  code: string;
  std_code?: string | null;
  area_code: string;
  area_name?: string | null;
  length?: number | null;
  area?: number | null;
  up_name?: string | null;
  department?: string | null;
  water_type?: string | null;
  landform?: string | null;
  layer?: string | null;
  basin_name?: string | null;
  s_name?: string | null;
  e_name?: string | null;
  grade?: string | null;
}

export interface RiverDeleteRequest {
  id?: number | null;
  ids?: number[] | null;
  force?: boolean;
}

export interface RiverDeleteResult {
  deleted?: number;
  skipped?: RiverReference[];
  not_found?: number[];
}

export interface RiverOption {
  id: number;
  name?: string | null;
  code?: string | null;
  std_code?: string | null;
  area_code?: string | null;
  area_name?: string | null;
}

export interface RiverReference {
  id?: number | null;
  code?: string | null;
  name?: string | null;
  references?: Record<string, number>;
}

export interface RiverUpdateRequest {
  name?: string | null;
  code?: string | null;
  std_code?: string | null;
  area_code?: string | null;
  area_name?: string | null;
  length?: number | null;
  area?: number | null;
  up_name?: string | null;
  department?: string | null;
  water_type?: string | null;
  landform?: string | null;
  layer?: string | null;
  basin_name?: string | null;
  s_name?: string | null;
  e_name?: string | null;
  grade?: string | null;
  id: number;
}

export interface SysDistrict {
  id: number;
  name: string;
  code: string;
  type?: string | null;
  city?: string | null;
  city_code?: string | null;
  city_type?: string | null;
  province?: string | null;
  province_code?: string | null;
  province_type?: string | null;
  former_name?: string | null;
  note?: string | null;
  eng_name?: string | null;
  var_name?: string | null;
}
