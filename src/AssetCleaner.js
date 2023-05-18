const fs = require('fs');
const path = require('path');
const FileHelper = require('./FileHelper');
const Utils = require('./Utils');

let ResType = {
    Image: 0, // 普通图片
    ImageAtlas: 1, // 大图
    LabelAtlas: 2, // 艺术数字
    Anim: 3, // 动画文件
    Spine: 4, // Spine
    Prefab: 5, // prefab
    Fire: 6, // 场景文件
    Code: 7, // js代码 
    Fnt: 8 // 位图
};

let ResExt = [
    { name:'.plist', type:ResType.ImageAtlas },
    { name:'.fnt', type:ResType.Fnt },
    { name:'.labelatlas', type:ResType.LabelAtlas },
    { name:'.json', type:ResType.Spine }, // spine和dragonBones的扩展名、查找流程一样
];

let AssetCleaner = {
    sourceMap: null,//被引用的源文件列表， Map<{path, {uuid: uuid数组, type, size, name}}>, 含有预制体、动画、jpg、png、webp
    destMap: null,// 用于引用别的文件的大文件， Map<path, {data：文件字符串数据}>, 含有骨骼、脚本、预制体、动画、场景（这里简称大文件，意思就是会引用到其他小文件的资源文件）
    handleMap: null,// 图片处理过的文件列表, Map<path, {handle：boolean}>记录图片是否已经处理过
    resourcesDir: 'resources',//资源目录路径

    /**
     * 开始清理
     * @param {string} sourceFile 源文件路径
     * @param {string} destFile 目标文件路径
     */
    start(sourceFile, destFile) {
        // 检查参数是否合法
        if (!sourceFile || sourceFile.length <= 0 || !destFile || destFile.length <= 0) {
            console.error('Cleaner: invalid source or dest');
            return;
        }

        // 初始化
        this.sourceMap = new Map(); 
        this.destMap = new Map(); 
        this.handleMap = new Map(); 
        this.resourcesDir = path.join('/', this.resourcesDir, '/'); 

        // 获取源文件和目标文件的绝对路径
        sourceFile = FileHelper.getFullPath(sourceFile);
        destFile = FileHelper.getFullPath(destFile);

        console.log("###sourceFile", sourceFile);
        console.log("###destFile", destFile);

        // 查找源文件中的所有资源文件
        this.lookupAssetDir(sourceFile);

        console.log("###sourceMap", this.sourceMap.size)
        
        console.log("###destMap", this.destMap.size)

        // 比较源文件和目标文件中的资源文件，获取未被引用的文件列表和非动态调用的文件列表
        let { noBindMap, noLoadMap } = this.compareAssets();

        // 生成未被引用的文件列表和非动态调用的文件列表
        let outStr1 = '未引用文件数量=';
        outStr1 = this.getSortedResult(outStr1, noBindMap, sourceFile, global._delete);
        let outStr2 = '非动态调用(无需放在resources下)文件数量=';
        outStr2 = this.getSortedResult(outStr2, noLoadMap, sourceFile);

        // 将未被引用的文件列表和非动态调用的文件列表合并，并写入目标文件
        let outStr = outStr1 + '\n' + outStr2;
        FileHelper.writeFile(destFile, outStr);

        // console.log("###handleMap", this.handleMap);
    },


    /**
     * 查找源文件中的所有资源文件
     *
     * @param {*} outStr 输出内容
     * @param {*} outMap 输出文件列表Map<type, {path, size}>, 即Map<资源类型, {路径, 资源大小}>, 
     * @param {*} srcDir 源文件目录
     * @param {*} isDelete 是否删除
     */
    getSortedResult(outStr, outMap, srcDir, isDelete) {
        let totalCount = 0; // 文件总数
        let totalSize = 0; // 文件总大小
        let content = ''; // 输出内容
        const exclude = global._excludes && new RegExp(global._excludes, 'gi') // 排除文件正则表达式
        let fileCount = 0; // 删除文件数量
        let metaFileCount = 0; // 删除meta文件数量
        let cleanContent = ''; // 删除日志内容
        let cleanFlag = false // 是否已经生成删除日志
        
        /**
         * 清除所有无用资源后生成删除日志
         */
        const fileCountHandle = FileHelper.debounce(() => { // 防抖函数，避免频繁写入文件
            const printText = `共删除${fileCount}个原始资源\n`
            cleanContent = printText + cleanContent
            if (cleanFlag) {
                FileHelper.writeFile(srcDir + '\\cleanFiles.txt', cleanContent);
            } else {
                cleanFlag = true
            }
        })

        
        const metaFileCountHandle = FileHelper.debounce(() => { // 防抖函数，避免频繁写入文件
            const printText = `共删除${metaFileCount}个meta资源\n`
            cleanContent = printText + cleanContent
            if (cleanFlag) {
                FileHelper.writeFile(srcDir + '\\cleanFiles.txt', cleanContent);
            } else {
                cleanFlag = true
            }
        })

        for (let [type, files] of outMap.entries()) { // 遍历文件列表
            if (files.length <= 0) { // 如果文件列表为空则跳过
                continue;
            }
    
            // 按从大到小排列
            files.sort(function(a, b) { // 根据文件大小排序
                return b.size - a.size;
            });
    
            for (let i = 0, len = files.length; i < len; i++) { // 遍历文件列表
                let file = files[i];
                content += '空间=' + Utils.byte2KbStr(file.size) + 'KB, 文件=' + file.path + '\n'; // 输出文件信息
                totalSize += file.size; // 计算文件总大小
                const isExcludes = exclude && file.path.search(exclude) !== -1 // 判断是否为排除文件
                const isResourcesDir = file.path.includes(this.resourcesDir) // 判断是否为资源目录下的文件
                // 有删除参数（-d）时，非resources目录，非排除类文件，会自动删除
                if (isDelete && !isResourcesDir && !isExcludes) { // 如果有删除参数且不是资源目录下的文件且不是排除类文件，则删除文件
                    fs.unlink(file.path, err => { // 删除文件
                        if (err) return console.error(err.message);
                        cleanContent += file.path + '\n'
                        fileCount++;
                        fileCountHandle();
                    })
                    fs.unlink(file.path + '.meta', err => { // 删除meta文件
                        if (err) return console.warn(err.message);
                        cleanContent += file.path + '.meta\n'
                        metaFileCount++;
                        metaFileCountHandle();
                    })
                }
            }

            totalCount += files.length;
            content += '\n';
        }
        
        outStr += totalCount;
        outStr += ', 占用空间=' + Utils.byte2MbStr(totalSize) + 'MB, 目录=' + srcDir + '\n\n';
        outStr += content;
        if (isDelete && content) {
            outStr += `\n如果终端未显示错误，则未引用文件已全部删除(包含meta文件，不包含排除文件)\n`;
        }
        return outStr;
    },


    /**
     * 源文件(小文件)和目标文件(大文件)逐个比较，返回引用结果
     *
     * @return {*} 
     */
    compareAssets() {
        let noBindMap = new Map();// 未被引用资源Map<ResType, [path: string, size: number]>, 资源类型
        let noLoadMap = new Map();// 非动态加载资源
        
        // 如果源UUID在所有目标资源都未找到，则说明源UUID对应的文件未被引用
        for (let [srcPath, srcData] of this.sourceMap.entries()) {
            let isBind = this.findAssetByUUID(srcPath, srcData);;//源文件是否被大文件引用

            let bDynamic = (srcPath.indexOf(this.resourcesDir) >= 0);// 是否为动态资源，即在resources下
            let isCodeLoad = false;// 资源是否是否被动态加载            
            if (bDynamic) {
                isCodeLoad = this.findAssetByName(srcPath, srcData);
            }

            if (!isBind && !isCodeLoad) {//如果没有被大文件引用，且没有代码去动态加载，则加入未被引用map
                let files = noBindMap.get(srcData.type);
                if (!files) {
                    files = [];
                    noBindMap.set(srcData.type, files);
                }
                files.push({ path:srcPath, size:srcData.size });
            } else if (bDynamic && isBind && !isCodeLoad) {  // 如果是resources下的动态资源，且被绑定但未被动态加载，则加入未被动态加载列表
                let files = noLoadMap.get(srcData.type);
                if (!files) {
                    files = [];
                    noLoadMap.set(srcData.type, files);
                }
                files.push({ path:srcPath, size:srcData.size });
            }
        }

        // console.log("###未被引用资源noBindMap", noBindMap, "resources下未被引用的资源noLoadMap", noLoadMap);

        return { noBindMap, noLoadMap };

        //noBindMap例子{
        //     3 => [
        //         {
        //             path: 'D:\\PROJECT\\yaji\\archero\\assets\\res\\animation\\loading.anim',
        //             size: 6334
        //         },
        //         {
        //             path: 'D:\\PROJECT\\yaji\\archero\\assets\\res\\effect\\jetFires\\jetFiresAni2.anim',
        //             size: 5517
        //         },
        //         {
        //             path: 'D:\\PROJECT\\yaji\\archero\\assets\\res\\model\\scene\\skyBoxTex\\skyBox.anim',
        //             size: 5554
        //         }
        //     ],
        //         5 => [
        //             {
        //                 path: 'D:\\PROJECT\\yaji\\archero\\assets\\res\\effect\\arrow\\arrow.prefab',
        //                 size: 7818
        //             },
        //             {
        //                 path: 'D:\\PROJECT\\yaji\\archero\\assets\\res\\effect\\arrow\\arrowAll.prefab',
        //                 size: 56190
        //             },
        //             {
        //                 path: 'D:\\PROJECT\\yaji\\archero\\assets\\res\\effect\\arrow\\arrowFire.prefab',
        //                 size: 20449
        //             },
        //         ]
        //     }
    },
    
    /**
     * 查找一下源文件是否被引用了
     * @param {string} srcPath - 源文件路径
     * @param {object} srcData - 源文件数据
     * @returns {boolean} - 是否在目标资源中找到源UUID
     */
    findAssetByUUID(srcPath, srcData) {
        let bFound = false;
        if (!srcPath || !srcData) {
            return bFound;
        }
        for (let [destPath, destData] of this.destMap.entries()) {
            // 如果源文件路径和目标文件路径相同，或者目标文件类型为代码文件，则跳过
            if (srcPath == destPath || ResType.Code === destData.type) {
                continue;
            }

            if (!!srcData && !!srcData.uuid) {  
                for (let i = 0, len = srcData.uuid.length; i < len; i++) {
                    let uuid = srcData.uuid[i];
                    if (destData.data.indexOf(uuid) >= 0) {
                        bFound = true;
                        return bFound; // 源UUID数组只要有一个被引用，即代表源文件被引用了，无需继续查找
                    }
                }
            }
        }
        return bFound;
    },


    /**
     * 查找脚本中动态加载的.prefab、.anim
     * （个人觉得这个很容易漏掉）
     *
     * @param {*} srcPath
     * @param {*} srcData
     * @return {*} 
     */
    findAssetByName(srcPath, srcData) {
        let bFound = false;//是否在目标资源中找到源文件名
        if (!srcPath || !srcData) {
            return bFound;
        }
        for (let [destPath, destData] of this.destMap.entries()) {
            // 目标资源必须是代码文件
            if (srcPath == destPath || ResType.Code !== destData.type) { 
                continue;
            }
            if (!!srcData && !!srcData.name && srcData.name.length > 0) {
                if (destData.data.indexOf(srcData.name) >= 0) {
                    console.log("####findAssetByName", srcData.name, " 路径 ", destPath)
                    bFound = true;
                    break;
                }
            }
        }
        return bFound;
    },

    // 递归查找指定目录下所有资源
    lookupAssetDir(srcDir, callback) {
        if (!srcDir || !fs.existsSync(srcDir)) {    
            console.error("AssetCleaner: invalid srcDir=" + srcDir);
            return;
        }

        let files = fs.readdirSync(srcDir);
        for (let i = 0, len = files.length; i < len; i++) {
            let file = files[i];
            let curPath = path.join(srcDir, file);//如：D:\PROJECT\yaji\archero\library\80\80aabd92-9942-4765-b685-8577a1c88b4e.jpg

            // 如果该文件已处理过则直接跳过
            if (this.handleMap.has(curPath)) {
                continue;
            }

            let stats = fs.statSync(curPath);
            if (stats.isDirectory()) {
                this.lookupAssetDir(curPath);
                continue;
            }

            let data = null;
            let uuid = [];
            //路径解析：//如：{ root: 'D:\\', dir: 'D:\\PROJECT\\yaji\\archero\\library\\80', base: '80aabd92-9942-4765-b685-8577a1c88b4e.jpg', ext: '.jpg', name: '80aabd92-9942-4765-b685-8577a1c88b4e' }
            let pathObj = path.parse(curPath);
            // Sprine资源
            if (curPath.includes('.json.meta')) {
                data = FileHelper.getFileString(curPath);
                this.destMap.set(curPath, { data, type: ResType.Spine });
                continue
            }
            // 针对各类型文件做相应处理
            switch (pathObj.ext) {
                case '.js':
                case '.ts':
                    data = FileHelper.getFileString(curPath);
                    this.destMap.set(curPath, { data, type:ResType.Code });
                    break;

                case '.prefab':
                    uuid = this.getFileUUID(curPath, pathObj, ResType.Prefab);
                    data = { uuid, type:ResType.Prefab, size:stats.size, name:'' };
                    if (curPath.indexOf(this.resourcesDir) >= 0) {
                        data.name = pathObj.name; // resources下文件需按文件名在代码中查找
                    }
                    this.sourceMap.set(curPath, data);
                    
                    data = FileHelper.getFileString(curPath);
                    this.destMap.set(curPath, { data, type:ResType.Prefab });
                    break;

                case '.anim':
                    if (curPath.indexOf(this.resourcesDir) < 0) { // 暂时排除resources下.anim
                        uuid = this.getFileUUID(curPath, pathObj, ResType.Anim);
                        this.sourceMap.set(curPath, { uuid, type:ResType.Anim, size:stats.size });
                    }

                    data = FileHelper.getFileString(curPath);
                    this.destMap.set(curPath, { data, type:ResType.Anim });
                    break;

                case '.fire':
                    data = FileHelper.getFileString(curPath);
                    this.destMap.set(curPath, { data, type:ResType.Fire });
                    break;
                    
                case '.png':
                case '.jpg':
                case '.webp':
                    if (curPath.indexOf(this.resourcesDir) >= 0) { // 暂时不处理resources下图片
                        break;
                    }
                    let type = this.getImageType(curPath, pathObj);
                    uuid = this.getFileUUID(curPath, pathObj, type);
                    type === ResType.Image && this.sourceMap.set(curPath, { uuid, type:type, size:stats.size });
                    break;

                default:
                    break;
            }
        }
    },

    // 根据同一目录下该图片同名文件的不同扩展名来判断图片类型（.plist、.json、labelatlas、fnt）
    getImageType(srcPath, pathObj) {
        let type = ResType.Image;
        for (let i = 0, len = ResExt.length; i < len; i++) {
            let ext = ResExt[i];
            let testPath = path.join(pathObj.dir, pathObj.name) + ext.name;
            if (fs.existsSync(testPath)) {
                type = ext.type;
                this.handleMap.set(srcPath, { handled:true });
                break;
            }
        }
        return type;
    },

    // 获取普通图片的UUID
    getUUIDFromMeta(metaPath, sourceName) {
        let uuid = [];
        let meta = FileHelper.getObjectFromFile(metaPath);
        if (!!meta && !!meta.subMetas) {
            let obj = meta.subMetas[sourceName];
            if (!!obj && !!obj.uuid) {
                let id = obj.uuid.substring(0);
                uuid.push(id);
            }
        }
        return uuid;
    },

    // 获取普通文件的UUID
    getRawUUIDFromMeta(metaPath) {
        let uuid = [];
        let meta = FileHelper.getObjectFromFile(metaPath);
        if (!!meta && !!meta.uuid) {
            let rawUUID = meta.uuid.substring(0);
            uuid.push(rawUUID);
        }
        return uuid;
    },

    // 从Plist中获取所有碎图的uuid
    getPlistUUIDFromMeta(metaPath) {
        let uuid = [];
        let meta = FileHelper.getObjectFromFile(metaPath);
        if (!!meta && !!meta.uuid) {
            let rawUUID = meta.uuid.substring(0);
            uuid.push(rawUUID); // 记录自身ID
        }
        if (!!meta && !!meta.subMetas) {
            for (let name in meta.subMetas) {
                let obj = meta.subMetas[name];
                if (obj && obj.uuid) {
                    let id = obj.uuid.substring(0);
                    uuid.push(id); // 记录碎图ID
                }
            }
        }
        return uuid;
    },

    // 返回不同类型文件的UUID

    /**
     * 获取文件的UUID数组
     *
     * @param {*} srcPath 资源路径
     * @param {*} pathObj 资源路径对象{root, dir, base, ext, name}
     * {
     *      root: 'D:\\',
            dir: 'D:\\PROJECT\\yaji\\archero\\assets\\res\\effect\\recovery',
            base: 'recovery.prefab',
            ext: '.prefab',
            name: 'recovery'
}
     * }
     * @param {*} type 资源类型， ResType
     * @return {*} 
     */
    getFileUUID(srcPath, pathObj, type) {
        let uuid = [];
        let destPath = '';
        switch(type) {
            case ResType.Image:
                destPath = srcPath + '.meta';
                // 当前UUID + 原始UUID，解决Spine动画配置文件与资源文件不同名，或一个Spine动画引用多个图片资源
                uuid = this.getUUIDFromMeta(destPath, pathObj.name).concat(this.getRawUUIDFromMeta(destPath)); // 当前UUID
                break;
            case ResType.ImageAtlas:
                destPath = path.join(pathObj.dir, pathObj.name) + '.plist.meta';
                uuid = this.getPlistUUIDFromMeta(destPath);
                console.log("scrPath", srcPath, "uuid", uuid);
                break;
            case ResType.LabelAtlas:
                destPath = path.join(pathObj.dir, pathObj.name) + '.labelatlas.meta';
                uuid = this.getRawUUIDFromMeta(destPath);
                break;
            case ResType.Anim:
                destPath = srcPath + '.meta';
                uuid = this.getRawUUIDFromMeta(destPath, pathObj.name);
                break;
            case ResType.Spine:
                destPath = path.join(pathObj.dir, pathObj.name) + '.json.meta';
                uuid = this.getRawUUIDFromMeta(destPath);
                break;
            case ResType.Prefab:
                destPath = srcPath + '.meta';
                uuid = this.getRawUUIDFromMeta(destPath);
                break;
            case ResType.Code:
                uuid.push(pathObj.name);
                break;
            default:
                break;
        }

        return uuid;
    },

};

module.exports = AssetCleaner;

