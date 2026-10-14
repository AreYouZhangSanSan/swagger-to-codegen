// Auto-generated API module: 空间元素
import { request } from "../../request";
import type {
  DistrictCreateRequest,
  DistrictDeleteRequest,
  DistrictUpdateRequest,
  Result_DistrictDeleteResult_,
  Result_HyoRiver_,
  Result_PageResponse_HyoRiver__,
  Result_PageResponse_SysDistrict__,
  Result_RiverDeleteResult_,
  Result_SysDistrict_,
  Result_list_DistrictOption__,
  Result_list_RiverOption__,
  RiverCreateRequest,
  RiverDeleteRequest,
  RiverUpdateRequest,
} from "../types/api";

/**
 * 分页查询行政区划【行政区划】
 *
 * @param params - 查询参数
 */
export function fetchList_district_space(params: {
  current?: number;
  size?: number;
  order?: string;
  order_by?: string;
  name?: string | null;
  code?: string | null;
  type?: string | null;
  city?: string | null;
  city_code?: string | null;
  province?: string | null;
  province_code?: string | null;
  keyword?: string | null;
}): Promise<Result_PageResponse_SysDistrict__> {
  return request({ url: "/api/v1/space/district/page", method: "get", params });
}

/**
 * 根据id或code查询行政区划详情【行政区划】
 *
 * @param params - 查询参数
 */
export function fetchGet_district_detail(params: {
  id?: number;
  code?: string;
}): Promise<Result_SysDistrict_> {
  return request({
    url: "/api/v1/space/district/detail",
    method: "get",
    params,
  });
}

/**
 * 新增行政区划【行政区划】
 */
export function fetchCreate_district_endpoint(
  data: DistrictCreateRequest,
): Promise<Result_SysDistrict_> {
  return request({ url: "/api/v1/space/district", method: "post", data });
}

/**
 * 更新行政区划【行政区划】
 */
export function fetchUpdate_district_endpoint(
  data: DistrictUpdateRequest,
): Promise<Result_SysDistrict_> {
  return request({
    url: "/api/v1/space/district/update",
    method: "post",
    data,
  });
}

/**
 * 删除行政区划【行政区划】
 */
export function fetchDelete_district_endpoint(
  data: DistrictDeleteRequest,
): Promise<Result_DistrictDeleteResult_> {
  return request({ url: "/api/v1/space/district/del", method: "post", data });
}

/**
 * 查询省级行政区划下拉列表【行政区划】
 *
 * @param params - 查询参数
 */
export function fetchList_provinces_endpoint(params: {
  keyword?: string;
}): Promise<Result_list_DistrictOption__> {
  return request({
    url: "/api/v1/space/district/provinces",
    method: "get",
    params,
  });
}

/**
 * 查询市级行政区划下拉列表【行政区划】
 *
 * @param params - 查询参数
 */
export function fetchList_cities_endpoint(params: {
  province_code?: string;
  province?: string;
  keyword?: string;
}): Promise<Result_list_DistrictOption__> {
  return request({
    url: "/api/v1/space/district/cities",
    method: "get",
    params,
  });
}

/**
 * 查询县级行政区划下拉列表【行政区划】
 *
 * @param params - 查询参数
 */
export function fetchList_districts_endpoint(params: {
  city_code?: string;
  province_code?: string;
  keyword?: string;
}): Promise<Result_list_DistrictOption__> {
  return request({
    url: "/api/v1/space/district/options",
    method: "get",
    params,
  });
}

/**
 * 查询省-市-区三级行政区划树【行政区划】
 *
 * @param params - 查询参数
 */
export function fetchGet_district_tree(params: {
  province_code?: string;
  city_code?: string;
  keyword?: string;
}): Promise<Result_list_DistrictOption__> {
  return request({ url: "/api/v1/space/district/tree", method: "get", params });
}

/**
 * 分页查询河流水域【河流水域】
 *
 * @param params - 查询参数
 */
export function fetchList_river_space(params: {
  current?: number;
  size?: number;
  order?: string;
  order_by?: string;
  name?: string | null;
  code?: string | null;
  std_code?: string | null;
  area_code?: string | null;
  area_name?: string | null;
  basin_name?: string | null;
  up_name?: string | null;
  layer?: string | null;
  grade?: string | null;
  water_type?: string | null;
  landform?: string | null;
  department?: string | null;
  keyword?: string | null;
}): Promise<Result_PageResponse_HyoRiver__> {
  return request({ url: "/api/v1/space/river/page", method: "get", params });
}

/**
 * 根据id或code或std_code查询河流水域详情【河流水域】
 *
 * @param params - 查询参数
 */
export function fetchGet_river_detail(params: {
  id?: number;
  code?: string;
  std_code?: string;
}): Promise<Result_HyoRiver_> {
  return request({ url: "/api/v1/space/river/detail", method: "get", params });
}

/**
 * 查询河流水域下拉列表【河流水域】
 *
 * @param params - 查询参数
 */
export function fetchList_rivers_endpoint(params: {
  area_code?: string;
  name?: string;
  limit?: number;
}): Promise<Result_list_RiverOption__> {
  return request({ url: "/api/v1/space/river/options", method: "get", params });
}

/**
 * 新增河流水域【河流水域】
 */
export function fetchCreate_river_endpoint(
  data: RiverCreateRequest,
): Promise<Result_HyoRiver_> {
  return request({ url: "/api/v1/space/river", method: "post", data });
}

/**
 * 更新河流水域【河流水域】
 */
export function fetchUpdate_river_endpoint(
  data: RiverUpdateRequest,
): Promise<Result_HyoRiver_> {
  return request({ url: "/api/v1/space/river/update", method: "post", data });
}

/**
 * 删除河流水域【河流水域】
 */
export function fetchDelete_river_endpoint(
  data: RiverDeleteRequest,
): Promise<Result_RiverDeleteResult_> {
  return request({ url: "/api/v1/space/river/del", method: "post", data });
}
