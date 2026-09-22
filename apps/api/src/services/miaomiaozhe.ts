const BASE_URL = 'https://www.miaomiaozhe.com'

type ApiResponse<T> = {
    code?: number
    message?: string
    data?: T
}

export type MiaomiaoSku = {
    sku_id: string
    sku_name?: string
    prop_path_name?: string
    offer_unique_id: string
    is_sell?: number
    img?: string
}

export type MiaomiaoOfferDetail = {
    offer_unique_id: string
    offer_name: string
    main_goods_id: string

    shop: string
    shop_name: string

    price: number
    dpr_price?: number

    price_detail?: {
        final_price?: number
    }

    sku_list?: MiaomiaoSku[]
}

function normalizeToken(token: string) {
    const value = token
        .trim()
        .replace(/^Bearer\s+/i, '')

    if (!value) {
        throw new Error('MIAOMIAO_TOKEN 未配置')
    }

    return value
}

async function request<T>(
    token: string,
    path: string,
    init?: RequestInit,
): Promise<T> {
    const normalizedToken = normalizeToken(token)

    const response = await fetch(`${BASE_URL}${path}`, {
        ...init,

        headers: {
            accept: 'application/json, text/plain, */*',
            authorization: `Bearer ${normalizedToken}`,
            ...init?.headers,
        },
    })

    const text = await response.text()

    console.log('===== MIAOMIAO RESPONSE =====')
    console.log('path:', path)
    console.log('method:', init?.method ?? 'GET')
    console.log('status:', response.status)
    console.log(
        'content-type:',
        response.headers.get('content-type'),
    )
    console.log('body:', text)
    console.log('============================')

    if (!response.ok) {
        throw new Error(
            `喵喵折 HTTP ${response.status}: ${text.slice(0, 500)}`,
        )
    }

    let json: unknown

    try {
        json = JSON.parse(text)
    } catch {
        throw new Error(
            `喵喵折返回非 JSON: ${text.slice(0, 500)}`,
        )
    }

    // 有些接口可能是 { code, data }
    if (
        typeof json === 'object' &&
        json !== null &&
        'code' in json
    ) {
        const result = json as ApiResponse<T>

        if (
            result.code !== undefined &&
            result.code !== 200 &&
            result.code !== 0
        ) {
            throw new Error(
                result.message ||
                `喵喵折业务错误 code=${result.code}`,
            )
        }

        if (result.data !== undefined) {
            return result.data
        }
    }

    // 也兼容接口直接返回业务对象
    return json as T
}

export async function parseClipboard(
    token: string,
    content: string,
) {
    const data = await request<{
        offer_unique_id: string
    }>(
        token,
        '/api/zero/parseClipboard',
        {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                content,
            }),
        },
    )

    if (!data.offer_unique_id) {
        throw new Error(
            'parseClipboard 未返回 offer_unique_id',
        )
    }

    return String(data.offer_unique_id)
}

export async function getOfferDetail(
    token: string,
    offerUniqueId: string,
) {
    const query = new URLSearchParams({
        offer_unique_id: offerUniqueId,
    })

    return request<MiaomiaoOfferDetail>(
        token,
        `/api/zero/offer/detail?${query.toString()}`,
        {
            method: 'GET',
        },
    )
}

function normalizePlatform(shop: string) {
    switch (shop) {
        case 'tb':
            return 'taobao'

        case 'tm':
            return 'tmall'

        default:
            return shop
    }
}

export async function resolveOffer(
    token: string,
    content: string,
) {
    const offerUniqueId =
        await parseClipboard(token, content)

    console.log(
        'parseClipboard offerUniqueId:',
        offerUniqueId,
    )

    const detail =
        await getOfferDetail(token, offerUniqueId)

    return {
        platform: normalizePlatform(detail.shop),

        externalItemId: String(
            detail.main_goods_id,
        ),

        title: detail.offer_name,

        shopName: detail.shop_name,

        providerRef: String(
            detail.offer_unique_id,
        ),

        currentPrice:
            detail.price_detail?.final_price ??
            detail.dpr_price ??
            detail.price,

        skus: (detail.sku_list ?? []).map(
            (sku) => ({
                externalSkuId: String(sku.sku_id),

                name:
                    sku.sku_name ??
                    sku.prop_path_name ??
                    String(sku.sku_id),

                providerRef: String(
                    sku.offer_unique_id,
                ),

                enabled: sku.is_sell !== 0,

                imageUrl: sku.img ?? null,
            }),
        ),
    }
}