// Auto-generated API module: 政策相关
import { request } from "../../request";
import {
  PolicyCreateRequest,
  PolicyUpdateRequest,
  PolicyDeleteRequest,
} from "./types/api.d";

/**
 * 分页查询政策文件
 *
 * @param params - 查询参数
 */
export function fetchList_policy_policy_page(params: {
  current?: number;
  size?: number;
  order?: string;
  order_by?: string;
  title?: any;
  category?: any;
  publish_department?: any;
}) {
  return request({ url: "/api/v1/policy/page", method: "get", params });
}

/**
 * 查询政策文件详情
 *
 * @param params - 查询参数
 */
export function fetchGet_policy_detail(params: { id: number }) {
  return request({ url: "/api/v1/policy/detail", method: "get", params });
}

/**
 * 创建政策文件
 */
export function fetchCreate_policy_api(data: PolicyCreateRequest) {
  return request({ url: "/api/v1/policy/create", method: "post", data });
}

/**
 * 更新政策文件
 */
export function fetchUpdate_policy_api(data: PolicyUpdateRequest) {
  return request({ url: "/api/v1/policy/update", method: "post", data });
}

/**
 * 删除政策文件
 */
export function fetchDelete_policy_api(data: PolicyDeleteRequest) {
  return request({ url: "/api/v1/policy/delete", method: "post", data });
}
